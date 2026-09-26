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
  type Board,
  type Move,
  type Stone,
} from "@/lib/gomoku";

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

/** 按模型配置生成推理参数：不做厂商特判，各协议只用自家的标准字段。
 *  开关关闭时也要显式关（有的端点思考默认开启，例如 deepseek-flash，缺省参数会被当成开） */
function thinkingParams(
  row: ModelConfigRow,
  effort: string | undefined,
  enabled: boolean,
): Record<string, unknown> {
  if (!row.thinkingEnabled) return {};
  const level = effort && row.effortLevels.includes(effort) ? effort : null;
  switch (row.protocol) {
    case "openai-chat":
      return enabled && level ? { reasoning_effort: level } : {};
    case "openai-responses":
      return enabled && level ? { reasoning: { effort: level } } : {};
    case "anthropic-messages":
      // Messages 协议没有 effort 概念，开关即协议标准的 enabled/disabled
      return enabled
        ? { thinking: { type: "enabled", budget_tokens: 2048 } }
        : { thinking: { type: "disabled" } };
    default:
      return {};
  }
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
    thinking = str(message?.reasoning_content) || str(message?.reasoning);
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
): Promise<CallResult> {
  const base = row.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  const think = thinkingParams(row, opts.effort, opts.thinking);
  // 思考开启时输出上限放大（思考本身耗 token）；显式 disabled 时维持小上限
  const thinkEnabled = asRecord(think.thinking)?.type === "enabled";
  let url: string;
  let body: Record<string, unknown>;

  switch (row.protocol) {
    case "openai-chat":
      url = `${base}/chat/completions`;
      headers.Authorization = `Bearer ${row.apiKey}`;
      body = {
        model: row.modelId,
        temperature: 0,
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
        max_tokens: opts.anthropicMaxTokens ?? (thinkEnabled ? 8192 : 2048),
        temperature: 0,
        stream: true,
        system,
        messages: [{ role: "user", content: user }],
        ...think,
      };
      break;
    default:
      return { ok: false, error: `未知协议：${row.protocol}` };
  }

  let res: Response;
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

  if (!res.ok) {
    const text = await res.text();
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      // 非 JSON 响应，走默认错误信息
    }
    const rec = asRecord(data);
    const errRec = asRecord(rec?.error);
    return {
      ok: false,
      error: `HTTP ${res.status}：${str(errRec?.message) || res.statusText || "请求失败"}`,
    };
  }

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
        const th = str(delta.reasoning_content) || str(delta.reasoning);
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

function buildPrompt(
  board: Board,
  moves: Move[],
  aiColor: Stone,
  mistake: string | null,
  historyNote: string | null = null,
  speech = false,
  opponent: Opponent | null = null,
): { system: string; user: string } {
  const side = aiColor === "black" ? "黑棋（X）" : "白棋（O）";
  const saySpec = opponent
    ? "第二行只写「SAY 一句话」——以你的口吻说一句不超过 20 字的中文对局感言（像漫画角色台词，有气势，可以回应或挑衅对方），不要透露具体战术。"
    : "第二行只写「SAY 一句话」——以你的口吻说一句不超过 20 字的中文对局感言（像漫画角色台词，有气势），不要透露具体战术。";
  const formatSpec = speech
    ? `输出格式（严格遵守）：
第一行只写「MOVE 列字母行号」，例如「MOVE H8」。
${saySpec}`
    : `输出格式（严格遵守）：只输出一行「MOVE 列字母行号」，例如「MOVE H8」。`;
  const system = `${opponent
    ? `你正在与另一位 AI 选手「${opponent.name}」进行五子棋（Gomoku）对弈，人类用户正在旁观这场对决。`
    : "你正在与人类进行五子棋（Gomoku）对弈。"}

规则：
- 棋盘 15×15，列用字母 A-O 标记，行用数字 1-15 标记，如 H8 表示 H 列第 8 行。
- 黑棋先行，双方轮流在空交叉点落子。
- 横、竖、斜任意方向先连成五子（或以上）者获胜。

你执${side}，现在轮到你落子。

思考要求：思考要简短，依次检查三件事即可——对方下一手能否连五（能则必须堵）；自己这一手能否直接连五获胜；都不行就下在能形成自己连子或压制对方连子的交叉点。禁止穷举棋盘、禁止罗列所有方向。

${formatSpec}只能选择空交叉点。不要输出解释或其他内容。`;
  const opponentNote =
    opponent && opponent.lines.length > 0
      ? `对手「${opponent.name}」最近说过（从早到晚）：
${opponent.lines.map((l) => `「${l}」`).join("\n")}\n\n`
      : "";
  const user = `当前棋盘（X=黑棋，O=白棋，.=空位）：
${boardToText(board)}

${historyNote ? `${historyNote}\n` : ""}${opponentNote}落子历史：
${movesToText(moves)}

${mistake ?? "请给出你的下一步落子。"}`;
  return { system, user };
}

/** 服务端代理 AI 落子（密钥不出服务端）。请求体：
 *  modelId / aiColor / moves / effort / thinking / speech，
 *  可选 opponentName + opponentSpeech[]（AI 对 AI：对手名字与其最近台词，
 *  只喂台词不喂思维链）。流式 NDJSON 事件：
 *  {"type":"thinking","delta"} 思维链增量
 *  {"type":"notice","text"}    重试反馈说明
 *  {"type":"move","move","label"} 合法落子（终态）
 *  {"type":"error","error"}    失败（终态） */
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

  const turn: Stone = moves.length % 2 === 0 ? "black" : "white";
  if (turn !== aiColor) {
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
        // 输入上下文上限：超限时自动压缩。棋盘快照本身是完整局面，
        // 落子历史只是辅助阅读，从最早一手开始省略是安全的
        const contextLimit = model.contextLimit;
        let promptMoves = moves;
        let historyNote: string | null = null;
        if (contextLimit > 0) {
          const full = buildPrompt(board, moves, aiColor, null, null, speech, opponent);
          const fullEstimate = estimateTokens(full.system + full.user);
          if (fullEstimate > contextLimit) {
            let keep = moves.length;
            while (keep > 0) {
              const probe = buildPrompt(board, moves.slice(moves.length - keep), aiColor, null, null, speech, opponent);
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

        let mistake: string | null = null;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          const { system, user } = buildPrompt(board, promptMoves, aiColor, mistake, historyNote, speech, opponent);
          // 第二次尝试给 Messages 协议放大输出上限：应对思考失控截断
          const call = await callModel(model, system, user, {
            effort,
            thinking,
            anthropicMaxTokens: attempt === 0 ? undefined : 32768,
          }, (delta) => send({ type: "thinking", delta }));
          if (!call.ok) {
            // 思考截断属于可纠正失败：带着「压缩思考」的反馈再试一次
            if (call.retryable && attempt < MAX_ATTEMPTS - 1) {
              mistake = "你上一轮思考太长，回复被截断了。把思考压缩到五十字以内，直接给出落子。";
              send({ type: "notice", text: "思考过长被截断，已要求模型压缩思考后重试" });
              continue;
            }
            send({ type: "error", error: call.error });
            return;
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
        send({ type: "error", error: "模型连续两次都没给出合法落子，可以重试或换个模型" });
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
