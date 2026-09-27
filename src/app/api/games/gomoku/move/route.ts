import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { modelConfigs, type ModelConfigRow } from "@/db/schema";
import {
  BOARD_SIZE,
  applyMoves,
  boardToText,
  cellName,
  movesToText,
  parseAiMove,
  parseSwapChoice,
  type Board,
  type Move,
  type Stone,
} from "@/lib/gomoku";
import {
  anthropicThinkingOn,
  applyKnownThinkShape,
  applyThinkFallback,
  buildThinkParams,
  initThinkState,
  rememberThinkShape,
  thinkShapeKey,
  type ThinkState,
} from "@/lib/vendor-params";

/** AI 一手的整体耗时上限（推理模型可能较慢） */
const TIMEOUT_MS = 180_000;
/** 模型给出非法落子时的自动纠错重试次数 */
const MAX_ATTEMPTS = 2;

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** OpenAI 系响应里的思考内容：reasoning_content（DeepSeek 系）/ reasoning（OpenRouter 等）
 *  是字符串，reasoning_details（OpenRouter 新版）是数组，统一取增量文本 */
function deltaReasoning(v: unknown): string {
  if (typeof v === "string") return v;
  if (!Array.isArray(v)) return "";
  let s = "";
  for (const item of v) {
    const rec = asRecord(item);
    if (!rec) continue;
    if (typeof rec.text === "string") s += rec.text;
    else if (typeof rec.delta === "string") s += rec.delta;
  }
  return s;
}

type CallResult =
  | { ok: true; content: string; thinking: string }
  | { ok: false; error: string; retryable?: boolean };

/** 思维链增量回调：边收边推给前端 */
type EmitThinking = (delta: string) => void;

/** 逐行解析 SSE：取每条 data: 负载并 JSON 解析（跳过 [DONE] 与坏行） */
async function readSse(res: Response, onData: (obj: Record<string, unknown>) => void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        onData(JSON.parse(payload));
      } catch {
        // 忽略无法解析的行
      }
    }
  }
}

/** 非流式 JSON 响应的兜底解析（端点不支持 stream 时仍能用） */
function extractNonStream(protocol: string, rec: Record<string, unknown>): { content: string; thinking: string } {
  let content = "";
  let thinking = "";
  if (protocol === "openai-chat") {
    const message = asRecord(asRecord(asArray(rec.choices)[0])?.message);
    content = str(message?.content);
    // 接收侧兼容：reasoning_content（DeepSeek 系）与 reasoning
    thinking =
      deltaReasoning(message?.reasoning_content) ||
      deltaReasoning(message?.reasoning) ||
      deltaReasoning(message?.reasoning_details);
  } else if (protocol === "openai-responses") {
    content = str(rec.output_text);
    for (const item of asArray(rec.output)) {
      const it = asRecord(item);
      if (it?.type === "reasoning") {
        for (const c of asArray(it.content)) thinking += str(asRecord(c)?.text);
      } else if (it?.type === "message") {
        for (const c of asArray(it.content)) {
          const cr = asRecord(c);
          if (cr?.type === "output_text") content += str(cr.text);
        }
      }
    }
  } else {
    for (const block of asArray(rec.content)) {
      const b = asRecord(block);
      if (b?.type === "text") content += str(b.text);
      else if (b?.type === "thinking") thinking += str(b.thinking);
    }
  }
  return { content, thinking };
}

/** 流式调用一次模型：正文与思维链边收边推，收完汇总返回 */
async function callModel(
  row: ModelConfigRow,
  system: string,
  user: string,
  opts: { effort?: string; thinking: boolean; anthropicMaxTokens?: number },
  emitThinking: EmitThinking,
  emitNotice: (text: string) => void,
): Promise<CallResult> {
  const base = row.baseUrl.replace(/\/+$/, "");
  // 思考参数形态：各端点接受的字段不一，被 4xx 拒绝时按错误提示降级重试（最多两次）；
  // 同一端点+模型若已有成功形态，直接按它首发，省掉注定被拒的探路请求。
  // 采样参数（temperature/top_p）一律不传用默认值：推理模型普遍拒绝非默认采样参数
  const shapeKey = thinkShapeKey(row.baseUrl, row.modelId);
  let thinkState: ThinkState | null = applyKnownThinkShape(
    initThinkState(row, opts.effort, opts.thinking),
    shapeKey,
  );
  let res: Response | undefined;

  for (let shapeAttempt = 0; ; shapeAttempt++) {
    const think = buildThinkParams(thinkState);
    // 思考开启时输出上限放大（思考本身耗 token）；关或彻底不带时维持小上限
    const thinkOn = anthropicThinkingOn(thinkState);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    let url: string;
    let body: Record<string, unknown>;

    switch (row.protocol) {
      case "openai-chat":
        url = `${base}/chat/completions`;
        headers.Authorization = `Bearer ${row.apiKey}`;
        body = {
          model: row.modelId,
          stream: true,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          ...think,
        };
        break;
      case "openai-responses":
        url = `${base}/responses`;
        headers.Authorization = `Bearer ${row.apiKey}`;
        body = { model: row.modelId, instructions: system, input: user, stream: true, ...think };
        break;
      case "anthropic-messages":
        url = `${base}/v1/messages`;
        headers["x-api-key"] = row.apiKey;
        headers["anthropic-version"] = "2023-06-01";
        body = {
          model: row.modelId,
          max_tokens: opts.anthropicMaxTokens ?? (thinkOn ? 8192 : 2048),
          stream: true,
          system,
          messages: [{ role: "user", content: user }],
          ...think,
        };
        break;
      default:
        return { ok: false, error: `未知协议：${row.protocol}` };
    }

    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const aborted =
        e instanceof DOMException || (e instanceof Error && e.name === "TimeoutError");
      return {
        ok: false,
        error: aborted
          ? `模型请求超时（上限 ${TIMEOUT_MS / 1000}s）`
          : e instanceof Error
            ? e.message
            : String(e),
      };
    }

    if (res.ok) {
      if (thinkState) rememberThinkShape(shapeKey, thinkState);
      break;
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      // 非 JSON 响应，走默认错误信息
    }
    const rec = asRecord(data);
    const errRec = asRecord(rec?.error);
    const errMsg = str(errRec?.message) || res.statusText || "请求失败";
    const fb =
      thinkState && shapeAttempt < 2
        ? applyThinkFallback(thinkState, res.status, errMsg)
        : null;
    if (fb) {
      thinkState = fb.state;
      emitNotice(fb.note);
      continue;
    }
    return { ok: false, error: `HTTP ${res.status}：${errMsg}` };
  }

  if (!res) return { ok: false, error: "请求未发出" };

  let content = "";
  let thinking = "";
  let stopReason = "";
  const contentType = res.headers.get("content-type") ?? "";

  if (contentType.includes("application/json") || !res.body) {
    // 端点没按 SSE 流式返回：按一次性 JSON 兜底
    const text = await res.text();
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: "模型返回了无法解析的内容" };
    }
    const rec = asRecord(data);
    if (!rec) return { ok: false, error: "模型返回了空内容" };
    const picked = extractNonStream(row.protocol, rec);
    content = picked.content;
    thinking = picked.thinking;
    if (row.protocol === "anthropic-messages") stopReason = str(rec.stop_reason);
    if (thinking) emitThinking(thinking);
  } else {
    await readSse(res, (ev) => {
      if (row.protocol === "openai-chat") {
        const delta = asRecord(asRecord(asArray(ev.choices)[0])?.delta);
        if (!delta) return;
        const c = str(delta.content);
        if (c) content += c;
        const th =
          deltaReasoning(delta.reasoning_content) ||
          deltaReasoning(delta.reasoning) ||
          deltaReasoning(delta.reasoning_details);
        if (th) {
          thinking += th;
          emitThinking(th);
        }
      } else if (row.protocol === "openai-responses") {
        const t = str(ev.type);
        if (t === "response.output_text.delta") {
          content += str(ev.delta);
        } else if (t === "response.reasoning_summary_text.delta" || t === "response.reasoning_text.delta") {
          const th = str(ev.delta);
          if (th) {
            thinking += th;
            emitThinking(th);
          }
        }
      } else {
        // anthropic-messages
        const t = str(ev.type);
        if (t === "content_block_delta") {
          const d = asRecord(ev.delta);
          if (!d) return;
          const dt = str(d.type);
          if (dt === "thinking_delta") {
            const th = str(d.thinking);
            if (th) {
              thinking += th;
              emitThinking(th);
            }
          } else if (dt === "text_delta") {
            content += str(d.text);
          }
        } else if (t === "message_delta") {
          stopReason = str(asRecord(ev.delta)?.stop_reason);
        }
      }
    });
  }

  // 协议信号：思考吃满 max_tokens 且没产出正文，说明思考失控（budget_tokens 被端点忽略时会出现）
  if (row.protocol === "anthropic-messages" && !content.trim() && thinking && stopReason === "max_tokens") {
    return { ok: false, error: "思考太长被截断，没有产出落子", retryable: true };
  }
  if (!content.trim()) return { ok: false, error: "模型返回了空内容" };
  // 开了思考却整轮一个字都没回来：可能是网关剥离 reasoning（token 照计），
  // 也可能是模型自己没展开思考。中性告知一句，免得思维链面板空着像出了故障
  const thinkingRequested = thinkState
    ? thinkState.protocol === "anthropic-messages"
      ? anthropicThinkingOn(thinkState)
      : thinkState.openai !== null
    : false;
  if (thinkingRequested && !thinking.trim()) emitNotice("本轮未回传思维文本");
  return { ok: true, content, thinking };
}

/** 粗估 tokens：CJK 字符按 1 计，其余 4 字符折 1（通用启发式，不绑定分词器） */
function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) > 0x2e7f) cjk++;
    else other++;
  }
  return Math.ceil(cjk + other / 4);
}

/** 对手信息（AI 对 AI 模式）：名字 + 最近几句公开台词。
 *  只传台词不传思维链——思考过程是各选手私有的 */
type Opponent = { name: string; lines: string[] };

/** 落子后附一句台词的输出要求（对手在场时鼓励互动） */
function saySpecFor(opponent: Opponent | null): string {
  return opponent
    ? "第二行只写「SAY 一句话」——以你的口吻说一句不超过 20 字的中文对局感言（像漫画角色台词，有气势，可以回应或挑衅对方），不要透露具体战术。"
    : "第二行只写「SAY 一句话」——以你的口吻说一句不超过 20 字的中文对局感言（像漫画角色台词，有气势），不要透露具体战术。";
}

/** 对手最近台词的展示块（无台词时为空串） */
function opponentNoteFor(opponent: Opponent | null): string {
  return opponent && opponent.lines.length > 0
    ? `对手「${opponent.name}」最近说过（从早到晚）：
${opponent.lines.map((l) => `「${l}」`).join("\n")}\n\n`
    : "";
}

function buildPrompt(
  board: Board,
  moves: Move[],
  aiColor: Stone,
  mistake: string | null,
  historyNote: string | null = null,
  speech = false,
  opponent: Opponent | null = null,
  swap2Note = false,
): { system: string; user: string } {
  const side = aiColor === "black" ? "黑棋（X）" : "白棋（O）";
  const formatSpec = speech
    ? `输出格式（严格遵守）：
第一行只写「MOVE 列字母行号」，例如「MOVE H8」。
${saySpecFor(opponent)}`
    : `输出格式（严格遵守）：只输出一行「MOVE 列字母行号」，例如「MOVE H8」。`;
  const system = `${opponent
    ? `你正在与另一位 AI 选手「${opponent.name}」进行五子棋（Gomoku）对弈，人类用户正在旁观这场对决。`
    : "你正在与人类进行五子棋（Gomoku）对弈。"}

规则：
- 棋盘 15×15，列用字母 A-O 标记，行用数字 1-15 标记，如 H8 表示 H 列第 8 行。
- 黑棋先行，双方轮流在空交叉点落子。
- 横、竖、斜任意方向先连成五子（或以上）者获胜。${swap2Note ? `
- 本局以 Swap2 开局定色：棋盘上的开局子由双方按规则摆定，直接按当前局面行棋即可。` : ""}

你执${side}，现在轮到你落子。

思考要求：思考要简短，依次检查三件事即可——对方下一手能否连五（能则必须堵）；自己这一手能否直接连五获胜；都不行就下在能形成自己连子或压制对方连子的交叉点。禁止穷举棋盘、禁止罗列所有方向。

${formatSpec}只能选择空交叉点。不要输出解释或其他内容。`;
  const user = `当前棋盘（X=黑棋，O=白棋，.=空位）：
${boardToText(board)}

${historyNote ? `${historyNote}\n` : ""}${opponentNoteFor(opponent)}落子历史：
${movesToText(moves)}

${mistake ?? "请给出你的下一步落子。"}`;
  return { system, user };
}

/** Swap2 开局规则的固定说明（摆子/抉择提示词共用） */
const SWAP2_RULE_TEXT =
  "Swap2 开局：开局方先代双方摆前三子（第1手黑、第2手白、第3手黑）；随后应对方三选一——执白、换执黑、或加摆两子（第4手白、第5手黑）交给开局方定色；定色后由执白一方落下一手，此后正常对弈。";

/** Swap2 摆子阶段的提示词：who = 开局方摆前三子 / 应对方加摆两子 */
function buildSwap2PlacePrompt(
  board: Board,
  moves: Move[],
  who: "maker" | "responder",
  speech: boolean,
  opponent: Opponent | null,
  mistake: string | null,
): { system: string; user: string } {
  const idx = moves.length;
  const stoneZh = idx % 2 === 0 ? "黑X" : "白O";
  const roleText =
    who === "maker"
      ? `你是开局摆子方，正在摆前三子中的第 ${idx + 1} 手（${stoneZh}）。摆子目标：三子彼此有关联、攻守兼顾——黑优太明显会被对方换执黑，白亏太明显则自己吃亏，争取摆成双方都能接受的均衡局面。`
      : `你是应对方，已选择「加摆两子」：由你再摆第 4 手（白O）与第 5 手（黑X）。摆子目标：把局面修饰成让开局方无论执黑执白都不舒服，从而对你有利。现在摆第 ${idx + 1} 手（${stoneZh}）。`;
  const formatSpec = speech
    ? `输出格式（严格遵守）：
第一行只写「MOVE 列字母行号」，例如「MOVE H8」。
${saySpecFor(opponent)}`
    : `输出格式（严格遵守）：只输出一行「MOVE 列字母行号」，例如「MOVE H8」。`;
  const system = `${opponent
    ? `你正在与另一位 AI 选手「${opponent.name}」进行五子棋（Gomoku）对弈，人类用户正在旁观这场对决。`
    : "你正在与人类进行五子棋（Gomoku）对弈。"}

规则：
- 棋盘 15×15，列用字母 A-O 标记，行用数字 1-15 标记，如 H8 表示 H 列第 8 行。
- ${SWAP2_RULE_TEXT}

${roleText}

思考要求：思考要简短，选一个有棋理的交叉点即可，禁止穷举棋盘。

${formatSpec}只能选择空交叉点。不要输出解释或其他内容。`;
  const user = `当前棋盘（X=黑棋，O=白棋，.=空位）：
${boardToText(board)}

${opponentNoteFor(opponent)}开局摆子记录：
${movesToText(moves)}

${mistake ?? "请摆出这一手。"}`;
  return { system, user };
}

/** Swap2 抉择阶段的提示词：choose1 = 前三子后的三选一，choose2 = 加摆后的二选一 */
function buildSwap2ChoicePrompt(
  board: Board,
  moves: Move[],
  mode: "choose1" | "choose2",
  speech: boolean,
  opponent: Opponent | null,
  mistake: string | null,
): { system: string; user: string } {
  const who = mode === "choose1" ? "应对方" : "开局摆子方";
  const options =
    mode === "choose1"
      ? `- SWAP WHITE：你执白，对方执黑；定色后轮到你落第 4 手（白）。
- SWAP BLACK：你换执黑，对方执白；定色后对方落第 4 手（白）。
- SWAP PLACE2：你再摆两子（第 4 手白、第 5 手黑），随后对方必须定色。`
      : `- SWAP WHITE：你执白，对方执黑；定色后轮到你落第 6 手（白）。
- SWAP BLACK：你执黑，对方执白；定色后对方落第 6 手（白）。`;
  const hint =
    mode === "choose1"
      ? "判断提示：黑优明显就换执黑，白优明显就执白，局面均衡且想掌握主动时可加摆两子把难题交给对方。"
      : "判断提示：以你的棋风评估当前局面，选出后续更愿意执的一边。";
  const only =
    mode === "choose1"
      ? "「SWAP WHITE」「SWAP BLACK」「SWAP PLACE2」三选一"
      : "「SWAP WHITE」「SWAP BLACK」二选一";
  const formatSpec = speech
    ? `输出格式（严格遵守）：
第一行只写 ${only}。
${saySpecFor(opponent)}`
    : `输出格式（严格遵守）：只输出一行，${only}。`;
  const system = `${opponent
    ? `你正在与另一位 AI 选手「${opponent.name}」进行五子棋（Gomoku）对弈，人类用户正在旁观这场对决。`
    : "你正在与人类进行五子棋（Gomoku）对弈。"}

规则：
- 棋盘 15×15，列用字母 A-O 标记，行用数字 1-15 标记，如 H8 表示 H 列第 8 行。
- ${SWAP2_RULE_TEXT}

你是${who}，开局子已在棋盘上，现在由你定夺。

${options}

${hint}

${formatSpec}不要输出解释或其他内容。`;
  const user = `当前棋盘（X=黑棋，O=白棋，.=空位）：
${boardToText(board)}

${opponentNoteFor(opponent)}开局摆子记录：
${movesToText(moves)}

${mistake ?? "请给出你的抉择。"}`;
  return { system, user };
}

/** 服务端代理 AI 落子（密钥不出服务端）。请求体：
 *  modelId / aiColor / moves / effort / thinking / speech，
 *  可选 swap2（Swap2 开局阶段：place3 / place2 / choose1 / choose2 / done，
 *  done 表示定色后的正常行棋，提示词会带开局说明），
 *  可选 opponentName + opponentSpeech[]（AI 对 AI：对手名字与其最近台词，
 *  只喂台词不喂思维链）。流式 NDJSON 事件：
 *  {"type":"thinking","delta"} 思维链增量
 *  {"type":"notice","text"}    重试反馈说明
 *  {"type":"move","move","label"} 合法落子（终态）
 *  {"type":"swap","choice"}    Swap2 抉择 black/white/place2（终态）
 *  {"type":"error","error"}    失败（终态） */
const SWAP2_STAGES = ["place3", "place2", "choose1", "choose2", "done"] as const;
type Swap2Stage = (typeof SWAP2_STAGES)[number];

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }
  const r = asRecord(body);
  const modelId = str(r?.modelId);
  const aiColor: Stone = r?.aiColor === "white" ? "white" : "black";
  const effort = typeof r?.effort === "string" ? r.effort : undefined;
  // 对局页的思考开关（缺省按开处理，兼容旧调用方）
  const thinking = r?.thinking !== false;
  // 对局说话开关：开启时模型落子后附一句台词（缺省关）
  const speech = r?.speech === true;
  // Swap2 开局阶段（缺省 = 传统自由开局）
  const swap2Raw = r?.swap2;
  const swap2: Swap2Stage | undefined =
    typeof swap2Raw === "string" && (SWAP2_STAGES as readonly string[]).includes(swap2Raw)
      ? (swap2Raw as Swap2Stage)
      : undefined;
  // AI 对 AI 模式：对手名字与其最近几句公开台词（长度硬限制，防注入超长内容）
  const opponentName = str(r?.opponentName).slice(0, 40);
  const opponent: Opponent | null = opponentName
    ? {
        name: opponentName,
        lines: asArray(r?.opponentSpeech)
          .slice(-3)
          .map((v) => str(v).slice(0, 60))
          .filter((s) => s.length > 0),
      }
    : null;

  if (!modelId) {
    return NextResponse.json({ error: "缺少模型 ID" }, { status: 400 });
  }
  if (!Array.isArray(r?.moves) || r.moves.length > BOARD_SIZE * BOARD_SIZE) {
    return NextResponse.json({ error: "棋谱格式不正确" }, { status: 400 });
  }

  // 落子列表 → 带颜色棋谱（黑先），同时校验坐标合法且无重复
  const moves: Move[] = [];
  const board = applyMoves([]);
  for (const [i, raw] of (r?.moves as unknown[]).entries()) {
    const m = asRecord(raw);
    const row = Number(m?.row);
    const col = Number(m?.col);
    if (!Number.isInteger(row) || !Number.isInteger(col) ||
        row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
      return NextResponse.json({ error: "棋谱包含非法坐标" }, { status: 400 });
    }
    if (board[row][col]) {
      return NextResponse.json({ error: "棋谱包含重复落子" }, { status: 400 });
    }
    const stone: Stone = i % 2 === 0 ? "black" : "white";
    board[row][col] = stone;
    moves.push({ row, col, stone });
  }

  // Swap2 阶段与棋谱手数必须吻合
  if (swap2 === "place3" && moves.length > 2) {
    return NextResponse.json({ error: "开局摆子阶段棋谱不应超过 3 手" }, { status: 400 });
  }
  if (swap2 === "place2" && (moves.length < 3 || moves.length > 4)) {
    return NextResponse.json({ error: "加摆两子阶段棋谱应为 3~4 手" }, { status: 400 });
  }
  if (swap2 === "choose1" && moves.length !== 3) {
    return NextResponse.json({ error: "Swap2 抉择应在前三子摆好后进行" }, { status: 400 });
  }
  if (swap2 === "choose2" && moves.length !== 5) {
    return NextResponse.json({ error: "Swap2 定色应在五子摆好后进行" }, { status: 400 });
  }

  const turn: Stone = moves.length % 2 === 0 ? "black" : "white";
  // Swap2 开局/抉择阶段由阶段本身决定行动方，不走「轮到谁」的奇偶校验
  if ((!swap2 || swap2 === "done") && turn !== aiColor) {
    return NextResponse.json({ error: "现在还没轮到 AI 落子" }, { status: 400 });
  }

  const rows = await getDb()
    .select()
    .from(modelConfigs)
    .where(eq(modelConfigs.id, modelId))
    .limit(1);
  const model = rows[0];
  if (!model) {
    return NextResponse.json({ error: "找不到该模型配置" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let clientGone = false;
      const send = (obj: Record<string, unknown>) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          clientGone = true;
        }
      };
      try {
        const wantChoice = swap2 === "choose1" || swap2 === "choose2";
        const wantPlace = swap2 === "place3" || swap2 === "place2";
        // 输入上下文上限：超限时自动压缩。棋盘快照本身是完整局面，
        // 落子历史只是辅助阅读，从最早一手开始省略是安全的。
        // Swap2 开局的摆子/抉择提示词很短，不需要压缩。
        const contextLimit = model.contextLimit;
        let promptMoves = moves;
        let historyNote: string | null = null;
        if (!wantChoice && !wantPlace && contextLimit > 0) {
          const full = buildPrompt(board, moves, aiColor, null, null, speech, opponent, swap2 === "done");
          const fullEstimate = estimateTokens(full.system + full.user);
          if (fullEstimate > contextLimit) {
            let keep = moves.length;
            while (keep > 0) {
              const probe = buildPrompt(board, moves.slice(moves.length - keep), aiColor, null, null, speech, opponent, swap2 === "done");
              if (estimateTokens(probe.system + probe.user) <= contextLimit) break;
              keep -= 4;
            }
            if (keep < 0) keep = 0;
            promptMoves = moves.slice(moves.length - keep);
            historyNote = `（为控制输入长度，前 ${moves.length - keep} 手历史已省略，以上棋盘即当前完整局面，以此为准。）`;
            send({
              type: "notice",
              text: `输入约 ${fullEstimate} tokens，超过上限 ${contextLimit}，已省略前 ${moves.length - keep} 手历史`,
            });
          }
        }

        const build = (mistake: string | null): { system: string; user: string } =>
          wantChoice
            ? buildSwap2ChoicePrompt(board, moves, swap2!, speech, opponent, mistake)
            : wantPlace
              ? buildSwap2PlacePrompt(board, moves, swap2 === "place3" ? "maker" : "responder", speech, opponent, mistake)
              : buildPrompt(board, promptMoves, aiColor, mistake, historyNote, speech, opponent, swap2 === "done");

        let mistake: string | null = null;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          const { system, user } = build(mistake);
          // 第二次尝试给 Messages 协议放大输出上限：应对思考失控截断
          const call = await callModel(model, system, user, {
            effort,
            thinking,
            anthropicMaxTokens: attempt === 0 ? undefined : 32768,
          }, (delta) => send({ type: "thinking", delta }), (text) => send({ type: "notice", text }));
          if (!call.ok) {
            // 思考截断属于可纠正失败：带着「压缩思考」的反馈再试一次
            if (call.retryable && attempt < MAX_ATTEMPTS - 1) {
              mistake = "你上一轮思考太长，回复被截断了。把思考压缩到五十字以内，直接给出答复。";
              send({ type: "notice", text: "思考过长被截断，已要求模型压缩思考后重试" });
              continue;
            }
            send({ type: "error", error: call.error });
            return;
          }
          // Swap2 抉择：解析 SWAP BLACK / SWAP WHITE / SWAP PLACE2
          if (wantChoice) {
            const choice = parseSwapChoice(call.content, swap2 === "choose1");
            if (choice) {
              const sayMatch = speech ? call.content.match(/^SAY\s*[:：]?\s*(.+)$/m) : null;
              const speechText = sayMatch ? sayMatch[1].trim().slice(0, 60) : "";
              send({ type: "swap", choice, speech: speechText });
              return;
            }
            mistake = `你上一次的回复「${call.content.trim().slice(0, 200)}」没有给出合法抉择。只输出一行：${
              swap2 === "choose1"
                ? "SWAP WHITE / SWAP BLACK / SWAP PLACE2"
                : "SWAP WHITE / SWAP BLACK"
            }。`;
            send({ type: "notice", text: "上一次回复不合法（没解析出抉择），已反馈模型重新抉择" });
            continue;
          }
          const mv = parseAiMove(call.content);
          const invalid = !mv
            ? "没有解析出落子坐标"
            : mv.row < 0 || mv.row >= BOARD_SIZE || mv.col < 0 || mv.col >= BOARD_SIZE
              ? "坐标超出棋盘范围"
              : board[mv.row][mv.col]
                ? `${cellName(mv.row, mv.col)} 已有棋子`
                : null;
          if (mv && !invalid) {
            // 说话开启时解析第二行的 SAY 台词（最多保留 60 字）
            const sayMatch = speech ? call.content.match(/^SAY\s*[:：]?\s*(.+)$/m) : null;
            const speechText = sayMatch ? sayMatch[1].trim().slice(0, 60) : "";
            send({
              type: "move",
              move: mv,
              label: cellName(mv.row, mv.col),
              speech: speechText,
            });
            return;
          }
          mistake = `你上一次的回复「${call.content.trim().slice(0, 200)}」不合法（${invalid}）。`;
          send({ type: "notice", text: `上一次回复不合法（${invalid}），已反馈模型重新落子` });
        }
        send({
          type: "error",
          error: wantChoice
            ? "模型连续两次都没给出合法抉择，可以重试或换个模型"
            : "模型连续两次都没给出合法落子，可以重试或换个模型",
        });
      } finally {
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
