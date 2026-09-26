"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Avatar } from "@/components/Avatar";
import { GomokuBoard } from "@/components/GomokuBoard";
import { SiteNav } from "@/components/SiteNav";
import { Halftone, InkPanel, SpeechBubble, SpeedLines, StampBadge } from "@/components/manga";
import {
  BOARD_SIZE,
  applyMoves,
  cellName,
  findWin,
  type Move,
  type Stone,
  type WinInfo,
} from "@/lib/gomoku";
import { protocolMeta } from "@/lib/models";
import {
  getModelsServerSnapshot,
  getModelsSnapshot,
  isModelsLoaded,
  subscribeModels,
} from "@/lib/models-store";
import { useThinkStream } from "@/lib/useThinkStream";

type Phase = "setup" | "playing";

type ModelInfo = ReturnType<typeof getModelsSnapshot>[number];

/** 落子接口的流式事件（NDJSON，一行一个） */
type StreamEvent =
  | { type: "thinking"; delta: string }
  | { type: "notice"; text: string }
  | { type: "move"; move: { row: number; col: number }; speech?: string }
  | { type: "error"; error: string };

/** 一侧选手的配置 */
type SideCfg = { modelId: string; effort: string; thinkingOn: boolean; speechOn: boolean };

/** 已公开的一句台词：给对手的模型看，思维链则永不外泄 */
type SpeechEntry = { stone: Stone; text: string };

/** 自动对局两手之间的缓冲，方便观战阅读 */
const MOVE_GAP_MS = 600;

const inkBtn =
  "rounded-lg border-[3px] border-[#141414] px-4 py-2 text-sm font-bold text-[#141414] shadow-[3px_3px_0_#141414] transition-transform enabled:hover:-translate-y-0.5 enabled:active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40";

const selectCls =
  "mt-1 w-full rounded-lg border-[2.5px] border-[#141414] bg-white px-3 py-2 text-sm font-medium outline-none";

/** 黑白双雄对峙标记：横幅里的图形焦点 */
function ArenaMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 210 72" className={`block h-12 w-auto select-none ${className}`} aria-hidden>
      {/* 两侧速度线：制造对撞感 */}
      <line x1="54" y1="12" x2="66" y2="20" stroke="#141414" strokeWidth="3" strokeLinecap="round" />
      <line x1="50" y1="26" x2="64" y2="29" stroke="#141414" strokeWidth="3" strokeLinecap="round" />
      <line x1="156" y1="12" x2="144" y2="20" stroke="#141414" strokeWidth="3" strokeLinecap="round" />
      <line x1="160" y1="26" x2="146" y2="29" stroke="#141414" strokeWidth="3" strokeLinecap="round" />
      <circle cx="30" cy="36" r="20" fill="#141414" />
      <path
        d="M 21 26 a 13 13 0 0 1 9 -7"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity="0.6"
      />
      <circle cx="180" cy="36" r="20" fill="#FFFDF6" stroke="#141414" strokeWidth="2.6" />
      <path
        d="M 183 46 a 12.5 12.5 0 0 0 9.5 -6"
        fill="none"
        stroke="#CFC4A6"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <text
        x="105"
        y="46"
        textAnchor="middle"
        fontSize="30"
        fontWeight="900"
        fill="#C0392B"
        transform="rotate(-4 105 40)"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        VS
      </text>
    </svg>
  );
}

/** 思考/说话共用的墨线开关行 */
function ToggleRow({
  on,
  label,
  onToggle,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border-[2.5px] border-[#141414] bg-white px-3 py-1.5">
      <span className="text-sm font-medium text-neutral-600">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onToggle}
        className={`relative h-6 w-11 shrink-0 rounded-full border-[2.5px] border-[#141414] transition-colors ${
          on ? "bg-amber-400" : "bg-neutral-300"
        }`}
      >
        <span
          className={`absolute left-[3px] top-1/2 size-4 -translate-y-1/2 rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-[20px]" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

/** 思维链展示框：贴底自动滚动（用户上翻后暂停，翻回底部恢复） */
function ThinkBox({ text, on }: { text: string; on: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight });
  }, [text]);
  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="mt-2 min-h-0 max-h-48 flex-1 overflow-auto rounded-lg border-2 border-[#141414]/20 bg-white/70 p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap lg:max-h-none"
    >
      {text || (on ? "（这一手还没有收到思维链）" : "（这位选手没有开启思考）")}
    </div>
  );
}

/** 开局前一侧的配置表单 */
function SideSetupForm({
  stone,
  models,
  cfg,
  onChange,
}: {
  stone: Stone;
  models: ModelInfo[];
  cfg: SideCfg;
  onChange: (patch: Partial<SideCfg>) => void;
}) {
  const fallback =
    (stone === "black" ? models[0]?.id : (models[1]?.id ?? models[0]?.id)) || "";
  const modelId = cfg.modelId || fallback;
  const model = models.find((m) => m.id === modelId) ?? null;
  const thinkingAvailable = model?.thinkingEnabled === true;
  const effortLevels = model?.thinkingEnabled ? model.effortLevels : [];
  const effort = effortLevels.includes(cfg.effort) ? cfg.effort : (effortLevels[0] ?? "");
  return (
    <div className="mt-3 space-y-2.5">
      <div>
        <label htmlFor={`arena-model-${stone}`} className="text-xs font-bold text-neutral-600">
          选手
        </label>
        <select
          id={`arena-model-${stone}`}
          value={modelId}
          onChange={(e) => onChange({ modelId: e.target.value, effort: "" })}
          className={selectCls}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      {thinkingAvailable && (
        <ToggleRow
          on={cfg.thinkingOn}
          label={cfg.thinkingOn ? "⚡ 对局中思考" : "⚡ 直接落子"}
          onToggle={() => onChange({ thinkingOn: !cfg.thinkingOn })}
        />
      )}
      {thinkingAvailable && cfg.thinkingOn && effortLevels.length > 0 && (
        <div>
          <label htmlFor={`arena-effort-${stone}`} className="text-xs font-bold text-neutral-600">
            推理档位
          </label>
          <select
            id={`arena-effort-${stone}`}
            value={effort}
            onChange={(e) => onChange({ effort: e.target.value })}
            className="mt-1 w-full rounded-lg border-[2.5px] border-[#141414] bg-white px-3 py-1.5 font-mono text-sm outline-none"
          >
            {effortLevels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>
      )}
      <ToggleRow
        on={cfg.speechOn}
        label={cfg.speechOn ? "💬 落子后说一句" : "💬 保持沉默"}
        onToggle={() => onChange({ speechOn: !cfg.speechOn })}
      />
    </div>
  );
}

export default function ArenaPage() {
  const models = useSyncExternalStore(
    subscribeModels,
    getModelsSnapshot,
    getModelsServerSnapshot,
  );
  const [phase, setPhase] = useState<Phase>("setup");
  const [moves, setMoves] = useState<Move[]>([]);
  const [black, setBlack] = useState<SideCfg>({ modelId: "", effort: "", thinkingOn: true, speechOn: true });
  const [white, setWhite] = useState<SideCfg>({ modelId: "", effort: "", thinkingOn: true, speechOn: true });
  const [speechLog, setSpeechLog] = useState<SpeechEntry[]>([]);
  const [busyStone, setBusyStone] = useState<Stone | null>(null);
  const [error, setError] = useState<{ stone: Stone; msg: string } | null>(null);
  const [paused, setPaused] = useState(false);

  const blackThink = useThinkStream();
  const whiteThink = useThinkStream();

  // gameToken：重开/回配置后让在途请求的回调失效；startedPly：防同一局面重复请求
  const gameToken = useRef(0);
  const startedPly = useRef(-1);
  const logRef = useRef<HTMLDivElement | null>(null);

  // 派生值：黑方默认第一位选手，白方默认第二位（没有则与黑方同一位）
  const blackModel =
    models.find((m) => m.id === (black.modelId || models[0]?.id)) ?? null;
  const whiteModel =
    models.find((m) => m.id === (white.modelId || (models[1]?.id ?? models[0]?.id))) ?? null;
  const turn: Stone = moves.length % 2 === 0 ? "black" : "white";
  const draw = moves.length >= BOARD_SIZE * BOARD_SIZE;

  // 从最后一手派生胜负（moves 只追加/重置，无需额外状态）
  const win = useMemo<WinInfo | null>(() => {
    if (moves.length === 0) return null;
    const last = moves[moves.length - 1];
    return findWin(applyMoves(moves), last.row, last.col);
  }, [moves]);

  const ended = win !== null || draw;

  // 对局记录滚到最新
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [moves.length]);

  const resetMatch = () => {
    gameToken.current++;
    startedPly.current = -1;
    setMoves([]);
    setSpeechLog([]);
    blackThink.reset();
    whiteThink.reset();
    setBusyStone(null);
    setError(null);
    setPaused(false);
  };

  const startMatch = () => {
    resetMatch();
    setPhase("playing");
  };

  const backToSetup = () => {
    resetMatch();
    setPhase("setup");
  };

  const retryMove = () => setError(null);

  // 自动对局引擎：轮到哪边就替哪边流式请求一手；暂停/终局/出错即停。
  // 给对手的只有名字和最近几句台词——思维链各归各的展示框，永不进对方输入
  useEffect(() => {
    if (phase !== "playing" || ended || paused || error) return;
    if (busyStone) return;
    if (!isModelsLoaded()) return;
    if (startedPly.current === moves.length) return;
    const stone = turn;
    const cfg = stone === "black" ? black : white;
    const model = stone === "black" ? blackModel : whiteModel;
    startedPly.current = moves.length;
    const ply = moves.length + 1;
    const token = gameToken.current;
    const timer = setTimeout(() => {
      (async () => {
        if (!model) {
          setError({ stone, msg: "选手的模型配置不存在，请回配置重选" });
          return;
        }
        const effortLevels = model.thinkingEnabled ? model.effortLevels : [];
        const effort = effortLevels.includes(cfg.effort) ? cfg.effort : (effortLevels[0] ?? "");
        setBusyStone(stone);
        const ts = stone === "black" ? blackThink : whiteThink;
        ts.beginRound(ply, `── 第 ${ply} 手 · ${stone === "black" ? "黑" : "白"} ──`);
        const opponentStone: Stone = stone === "black" ? "white" : "black";
        const opponent = opponentStone === "black" ? blackModel : whiteModel;
        try {
          const res = await fetch("/api/games/gomoku/move", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              modelId: model.id,
              aiColor: stone,
              effort: effort || undefined,
              thinking: model.thinkingEnabled === true && cfg.thinkingOn,
              speech: cfg.speechOn,
              moves: moves.map(({ row, col }) => ({ row, col })),
              opponentName: opponent?.name ?? "",
              opponentSpeech: speechLog
                .filter((s) => s.stone === opponentStone)
                .slice(-3)
                .map((s) => s.text),
            }),
          });
          // 参数校验失败等仍是普通 JSON 错误
          const ct = res.headers.get("content-type") ?? "";
          if (!res.ok || ct.includes("application/json")) {
            const data = (await res.json().catch(() => null)) as { error?: string } | null;
            if (gameToken.current !== token) return;
            setBusyStone(null);
            setError({ stone, msg: data?.error ?? `请求失败（HTTP ${res.status}）` });
            return;
          }
          const reader = res.body!.getReader();
          const dec = new TextDecoder();
          let buf = "";
          let mv: { row: number; col: number } | null = null;
          let speechText = "";
          let errMsg = "";
          const handleEvent = (ev: StreamEvent) => {
            // 请求已失效（重开/回配置）时丢弃迟到事件，避免污染新一轮思考
            if (gameToken.current !== token) return;
            if (ev.type === "thinking") ts.append(ev.delta);
            else if (ev.type === "notice") ts.appendNotice(ev.text);
            else if (ev.type === "move") {
              mv = ev.move;
              speechText = ev.speech ?? "";
            } else if (ev.type === "error") errMsg = ev.error;
          };
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (!line) continue;
              try {
                handleEvent(JSON.parse(line) as StreamEvent);
              } catch {
                // 跳过不完整的行
              }
            }
            // 重开/回配置让位：中断读取，丢弃后续事件
            if (gameToken.current !== token) {
              reader.cancel().catch(() => {});
              return;
            }
          }
          if (gameToken.current !== token) return;
          setBusyStone(null);
          if (errMsg) {
            setError({ stone, msg: errMsg });
            return;
          }
          if (!mv) {
            setError({ stone, msg: "连接中断" });
            return;
          }
          const { row, col } = mv;
          if (speechText) setSpeechLog((prev) => [...prev, { stone, text: speechText }]);
          setMoves((prev) => [...prev, { row, col, stone }]);
        } catch {
          if (gameToken.current === token) {
            setBusyStone(null);
            setError({ stone, msg: "网络请求失败" });
          }
        }
      })();
    }, MOVE_GAP_MS);
    return () => {
      clearTimeout(timer);
      startedPly.current = -1;
    };
    // cleanup 里重置 startedPly：暂停后恢复、出错后重试都能重新发起这一手
  }, [
    phase,
    ended,
    paused,
    error,
    busyStone,
    turn,
    moves,
    speechLog,
    black,
    white,
    blackModel,
    whiteModel,
    blackThink,
    whiteThink,
  ]);

  const streaming =
    phase === "playing" && !ended && !paused && !error;

  const status = (() => {
    if (!isModelsLoaded()) return { title: "加载模型列表中…", sub: "" };
    if (phase === "setup") {
      return models.length === 0
        ? { title: "还没有选手", sub: "先去模型配置页请两位选手上场" }
        : { title: "准备开局", sub: "左右各选一位选手，按「开始对局」" };
    }
    const cur = turn === "black" ? blackModel : whiteModel;
    const curName = cur?.name ?? "选手";
    if (win) {
      const winnerName = (win.stone === "black" ? blackModel : whiteModel)?.name ?? "选手";
      return {
        title: `${winnerName} 五连制胜！`,
        sub: win.stone === "black" ? "黑方拿下了这场对决" : "白方拿下了这场对决",
      };
    }
    if (draw) return { title: "平局", sub: "棋盘上已经没有空位了" };
    if (error) {
      const errName = (error.stone === "black" ? blackModel : whiteModel)?.name ?? "选手";
      return { title: `${errName} 落子失败`, sub: "处理一下，重试后比赛继续" };
    }
    if (paused)
      return { title: "已暂停", sub: `轮到 ${curName}（${turn === "black" ? "黑" : "白"}方）` };
    return {
      title: `${curName} 正在思考`,
      sub: `第 ${moves.length + 1} 手 · ${turn === "black" ? "黑" : "白"}方 · 台词互相可见，思维链各自保密`,
    };
  })();

  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <SiteNav />

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 pt-3 pb-2 lg:h-[calc(100dvh-3.5rem)] lg:overflow-hidden">
        {/* 漫画横幅：紧凑单行，容纳标题 + 对局控制（整局控制在首屏内） */}
        <section className="relative shrink-0 overflow-hidden rounded-[10px] border-[3px] border-[#141414] bg-[#F7F0DF] text-[#141414] shadow-[5px_5px_0_rgba(0,0,0,0.55)]">
          <div className="pointer-events-none absolute inset-[5px] rounded-[6px] border border-[#141414]/30" aria-hidden />
          <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-black tracking-[0.4em] text-[#C0392B]">
                GOMOKU · AI VS AI
              </p>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
                <h1 className="text-xl font-black tracking-wide sm:text-2xl">AI 对战 · 五子棋</h1>
                <p className="text-xs font-medium text-neutral-600">两位 AI 轮番落子，你负责观战</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {phase === "setup" ? (
                <>
                  <ArenaMark className="-rotate-2 max-sm:hidden" />
                  <button
                    onClick={startMatch}
                    disabled={!isModelsLoaded() || models.length === 0}
                    className={`${inkBtn} bg-amber-400`}
                  >
                    开始对局
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setPaused((p) => !p)}
                    disabled={ended}
                    className={`${inkBtn} bg-white`}
                  >
                    {paused ? "继续" : "暂停"}
                  </button>
                  <button onClick={startMatch} className={`${inkBtn} bg-amber-400`}>
                    重新开局
                  </button>
                  <button onClick={backToSetup} className={`${inkBtn} bg-white`}>
                    回配置
                  </button>
                  <StampBadge className="border-[#C0392B] bg-[#C0392B] text-[#F7F0DF]">
                    {ended ? "终局" : paused ? "已暂停" : "对局中"}
                  </StampBadge>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="mt-3 grid min-h-0 flex-1 gap-4 lg:grid-cols-[290px_minmax(0,1fr)_290px] lg:grid-rows-[minmax(0,1fr)]">
          {/* 中路：棋盘 + 状态（纯观战，不响应点击）。三块都显式定行定列，
              避免 grid 稀疏自动放置把后声明的中路挤到第二行（行高被压扁） */}
          <div className="flex min-h-0 flex-col lg:col-start-2 lg:row-start-1">
            <div className="relative flex min-h-0 flex-1 items-center justify-center">
              <InkPanel className="relative mx-auto aspect-square w-full overflow-hidden lg:h-full lg:w-auto lg:max-w-full">
                <GomokuBoard
                  moves={moves}
                  winInfo={win}
                  interactive={false}
                  previewStone={null}
                  onCellClick={() => {}}
                />

                {phase === "playing" && ended && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#141414]/25 backdrop-blur-[1.5px]">
                    <div className="relative w-[300px] max-w-[86%]">
                      <div className="absolute -inset-12">
                        <SpeedLines seed={21} />
                      </div>
                      <div className="relative -rotate-2 rounded-[6px] border-[4px] border-[#141414] bg-[#F7F0DF] px-6 py-6 text-center shadow-[8px_8px_0_#141414]">
                        <p className="text-xs font-black tracking-[0.5em] text-[#C0392B]">
                          咚咚咚…！
                        </p>
                        <h2 className="mt-2 text-2xl font-black text-[#141414]">
                          {win
                            ? `${(win.stone === "black" ? blackModel : whiteModel)?.name ?? "选手"} 获胜`
                            : "平局"}
                        </h2>
                        <p className="mt-1 text-xs text-neutral-600">{status.sub}</p>
                        <button
                          onClick={startMatch}
                          className="mt-4 rounded-lg border-[3px] border-[#141414] bg-amber-400 px-5 py-2 text-sm font-black text-[#141414] shadow-[3px_3px_0_#141414] transition-transform hover:-translate-y-0.5"
                        >
                          再来一局
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </InkPanel>

              {/* 落子失败浮层：盖在棋盘上，不参与布局 */}
              {error && phase === "playing" && (
                <div className="absolute bottom-4 left-1/2 z-20 w-[min(92%,400px)] -translate-x-1/2 rounded-lg border-[3px] border-[#C0392B] bg-[#F7F0DF] px-4 py-3 text-sm text-[#C0392B] shadow-[5px_5px_0_rgba(0,0,0,0.35)]">
                  <p className="font-bold">
                    {(error.stone === "black" ? blackModel : whiteModel)?.name ?? "选手"} 落子失败：
                    {error.msg}
                  </p>
                  <p className="mt-1 text-xs text-neutral-600">对局已暂停</p>
                  <button
                    onClick={retryMove}
                    className="mt-2 rounded-md border-2 border-[#C0392B] px-3 py-1 text-xs font-bold transition-colors hover:bg-[#C0392B] hover:text-white"
                  >
                    重试这一手
                  </button>
                </div>
              )}
            </div>

            <SpeechBubble className="mt-3 shrink-0">
              {/* ＞＞＞ 放在标题行内：独立成行会撑高气泡 */}
              <p className="text-sm font-black">
                {status.title}
                {streaming && (
                  <span className="ml-1 inline-block animate-pulse font-black" aria-hidden>
                    ＞＞＞
                  </span>
                )}
              </p>
              {/* 副行常驻占位：内容为空时也保留行高，避免状态切换带得棋盘缩放 */}
              <p className="mt-0.5 text-xs text-neutral-600">{status.sub || "\u00A0"}</p>
            </SpeechBubble>

            {phase === "setup" && models.length === 0 && (
              <p className="mt-2 shrink-0 text-center text-xs text-neutral-500">
                还没有选手，
                <Link
                  href="/models"
                  className="font-bold text-[#B45309] underline underline-offset-2"
                >
                  去模型配置页添加 →
                </Link>
              </p>
            )}
          </div>

          {(["black", "white"] as const).map((stone) => {
            const cfg = stone === "black" ? black : white;
            const setCfg = stone === "black" ? setBlack : setWhite;
            const model = stone === "black" ? blackModel : whiteModel;
            const ts = stone === "black" ? blackThink : whiteThink;
            const thinkingOn = model?.thinkingEnabled === true && cfg.thinkingOn;
            const effortLevels = model?.thinkingEnabled ? model.effortLevels : [];
            const effort = effortLevels.includes(cfg.effort) ? cfg.effort : (effortLevels[0] ?? "");
            const lastSpeech =
              [...speechLog].reverse().find((s) => s.stone === stone)?.text ?? "";
            const sideStreaming = streaming && turn === stone;
            return (
              <aside
                key={stone}
                className={`flex min-h-0 flex-col gap-3 lg:row-start-1 ${
                  stone === "black" ? "lg:col-start-1" : "lg:col-start-3"
                }`}
              >
                {/* 选手卡：开局前是配置表单，开局后是应援卡 */}
                <InkPanel className="relative shrink-0 overflow-hidden p-4">
                  <Halftone
                    className="bottom-0 right-0 h-16 w-20"
                    id={`ht-arena-${stone}`}
                    opacity={0.12}
                  />
                  <div className="relative flex items-center justify-between gap-2">
                    <h2 className="text-base font-black">
                      {stone === "black" ? "● 黑方" : "○ 白方"}
                    </h2>
                    {phase === "playing" && !ended && sideStreaming && (
                      <span className="animate-pulse text-[10px] font-black tracking-[0.2em] text-[#C0392B]">
                        思考中
                      </span>
                    )}
                    {phase === "playing" && win?.stone === stone && (
                      <span className="rotate-3 text-xs font-black tracking-[0.2em] text-[#C0392B]">
                        WIN!
                      </span>
                    )}
                  </div>

                  {phase === "setup" ? (
                    !isModelsLoaded() ? (
                      <p className="mt-3 text-sm text-neutral-500">加载模型中…</p>
                    ) : (
                      <SideSetupForm
                        stone={stone}
                        models={models}
                        cfg={cfg}
                        onChange={(patch) => setCfg((c) => ({ ...c, ...patch }))}
                      />
                    )
                  ) : (
                    <>
                      <div className="relative mt-3 flex items-center gap-3">
                        <div className="shrink-0 rounded-full border-[3px] border-[#141414] bg-white p-0.5 shadow-[3px_3px_0_#141414]">
                          <Avatar
                            name={model?.name ?? "?"}
                            src={model?.avatar || undefined}
                            className="size-12"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black">{model?.name ?? "未选择"}</p>
                          <p className="truncate font-mono text-[10px] text-neutral-600">
                            {model?.modelId}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {model && (
                              <span className="rounded-full border-2 border-[#141414] bg-white px-2 py-0.5 text-[10px] font-bold">
                                {protocolMeta(model.protocol).label}
                              </span>
                            )}
                            <span className="rounded-full border-2 border-[#141414]/25 bg-[#F7F0DF] px-2 py-0.5 font-mono text-[10px] font-bold">
                              ⚡{thinkingOn ? effort || "开" : "关"} · 💬
                              {cfg.speechOn ? "开" : "关"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* 台词气泡：对手听得到的话。line-clamp-3 兜底防撑坏布局 */}
                      {lastSpeech && (
                        <SpeechBubble className="relative mt-3">
                          <p
                            className="line-clamp-3 break-words text-xs font-bold leading-relaxed"
                            title={lastSpeech}
                          >
                            {lastSpeech}
                          </p>
                        </SpeechBubble>
                      )}
                    </>
                  )}
                </InkPanel>

                {/* 思维链：只属于这一侧的观众席，对手永远看不到 */}
                {phase === "playing" && (
                  <InkPanel className="flex min-h-0 flex-1 flex-col p-4">
                    <h2 className="text-sm font-black">思维链</h2>
                    <ThinkBox text={ts.text} on={thinkingOn} />
                  </InkPanel>
                )}
              </aside>
            );
          })}
        </section>

        {/* 对局记录：横排棋谱条，最新一手高亮 */}
        {phase === "playing" && (
          <InkPanel className="mt-3 shrink-0 p-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black">对局记录</h2>
              <span className="text-xs font-bold text-neutral-500">{moves.length} 手</span>
            </div>
            <div ref={logRef} className="mt-2 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto pr-1">
              {moves.length === 0 ? (
                <p className="text-xs text-neutral-500">还没有落子</p>
              ) : (
                moves.map((m, i) => (
                  <span
                    key={i}
                    className={`rounded-md border-2 px-1.5 py-0.5 font-mono text-[11px] font-bold ${
                      i === moves.length - 1
                        ? "border-[#141414] bg-amber-200"
                        : "border-[#141414]/25 bg-white/70 text-neutral-700"
                    }`}
                  >
                    {i + 1} {m.stone === "black" ? "●" : "○"} {cellName(m.row, m.col)}
                  </span>
                ))
              )}
            </div>
          </InkPanel>
        )}
      </main>
    </div>
  );
}
