"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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

type Phase = "setup" | "playing";

/** 落子接口的流式事件（NDJSON，一行一个） */
type StreamEvent =
  | { type: "thinking"; delta: string }
  | { type: "notice"; text: string }
  | { type: "move"; move: { row: number; col: number }; speech?: string }
  | { type: "error"; error: string };

/** 五连制胜标记：五枚黑子 + 琥珀胜连线，横幅里的图形焦点 */
function GomokuMark({ className = "" }: { className?: string }) {
  const pts = [0, 1, 2, 3, 4].map((i) => ({ x: 26 + i * 58, y: 64 - i * 7 }));
  const last = pts[4];
  return (
    <svg viewBox="0 0 290 88" className={`block h-16 w-auto select-none ${className}`} aria-hidden>
      {/* 胜连线：墨衬底 + 琥珀主线（先画线，棋子压在线上） */}
      <line x1={pts[0].x} y1={pts[0].y} x2={last.x} y2={last.y}
        stroke="#141414" strokeWidth={13} strokeLinecap="round" opacity={0.15} />
      <line x1={pts[0].x} y1={pts[0].y} x2={last.x} y2={last.y}
        stroke="#F59E0B" strokeWidth={9.5} strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={20} fill="#141414" />
          <path d={`M ${p.x - 9} ${p.y - 6} a 12 12 0 0 1 8.5 -5.5`}
            fill="none" stroke="#ffffff" strokeWidth={2.6} strokeLinecap="round" opacity={0.55} />
          {i === 4 && (
            <circle cx={p.x} cy={p.y} r={23.5} fill="none" stroke="#F59E0B" strokeWidth={3} />
          )}
        </g>
      ))}
    </svg>
  );
}

const inkBtn =
  "rounded-lg border-[3px] border-[#141414] px-4 py-2 text-sm font-bold text-[#141414] shadow-[3px_3px_0_#141414] transition-transform enabled:hover:-translate-y-0.5 enabled:active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40";

// 思维链渲染控制：按「轮」累积与裁剪——展示总量超限就整轮丢最老的，
// 保底保留最近 THINK_MIN_ROUNDS 轮完整思考（max 档推理一轮就很长，不能按字数截半轮）。
// 流式增量先攒进 ref，节流刷新到 state，避免每个 delta 触发一次全量重排。
const THINK_KEEP_CHARS = 24000;
const THINK_MIN_ROUNDS = 2;
const THINK_FLUSH_MS = 120;

export default function GomokuPage() {
  const models = useSyncExternalStore(
    subscribeModels,
    getModelsSnapshot,
    getModelsServerSnapshot,
  );
  const [modelId, setModelId] = useState("");
  const [humanColor, setHumanColor] = useState<Stone>("black");
  const [effort, setEffort] = useState("");
  const [thinkingOn, setThinkingOn] = useState(true);
  const [speechOn, setSpeechOn] = useState(true);
  const [phase, setPhase] = useState<Phase>("setup");
  const [moves, setMoves] = useState<Move[]>([]);
  const [aiThinkingText, setAiThinkingText] = useState("");
  const [aiSpeech, setAiSpeech] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);

  // gameToken：重开/悔棋后让在途请求的回调失效；requestedAt：防止同一回合重复请求
  const gameToken = useRef(0);
  const requestedAt = useRef(-1);
  const logRef = useRef<HTMLDivElement | null>(null);
  // 思维链流式展示：贴底自动滚动（用户手动上翻后暂停，翻回底部恢复）
  const thinkRef = useRef<HTMLDivElement | null>(null);
  const stickBottom = useRef(true);
  // 思维链轮次缓冲：一轮 = AI 的一次落子思考；裁剪与节流都作用于这份 ref，state 只存展示文本
  const thinkRounds = useRef<{ ply: number; label: string; text: string }[]>([]);
  const thinkDropped = useRef(0);
  const thinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildThinkDisplay = useCallback(() => {
    const parts: string[] = [];
    if (thinkDropped.current > 0) parts.push(`⋯ 前 ${thinkDropped.current} 轮思考已省略 ⋯`);
    for (const r of thinkRounds.current) {
      if (r.text) parts.push(`${r.label}\n${r.text}`);
    }
    return parts.join("\n\n");
  }, []);
  const flushThink = useCallback(() => {
    thinkTimer.current = null;
    setAiThinkingText(buildThinkDisplay());
  }, [buildThinkDisplay]);
  const scheduleThinkFlush = useCallback(() => {
    if (thinkTimer.current === null) thinkTimer.current = setTimeout(flushThink, THINK_FLUSH_MS);
  }, [flushThink]);
  const appendThink = useCallback(
    (s: string) => {
      const rounds = thinkRounds.current;
      if (rounds.length === 0) return;
      rounds[rounds.length - 1].text += s;
      scheduleThinkFlush();
    },
    [scheduleThinkFlush],
  );
  const resetThink = useCallback(() => {
    if (thinkTimer.current !== null) {
      clearTimeout(thinkTimer.current);
      thinkTimer.current = null;
    }
    thinkRounds.current = [];
    thinkDropped.current = 0;
    setAiThinkingText("");
  }, []);

  // 派生值：默认选中第一个模型；推理档位不在该模型配置内时回落第一档
  const effectiveModelId = modelId || models[0]?.id || "";
  const selectedModel = models.find((m) => m.id === effectiveModelId) ?? null;
  const aiColor: Stone = humanColor === "black" ? "white" : "black";
  const turn: Stone = moves.length % 2 === 0 ? "black" : "white";
  const draw = moves.length >= BOARD_SIZE * BOARD_SIZE;
  // 本局是否让 AI 思考：模型支持推理 && 对局页开关打开
  const aiThinking = selectedModel?.thinkingEnabled === true && thinkingOn;
  const effortLevels = selectedModel?.thinkingEnabled ? selectedModel.effortLevels : [];
  const effectiveEffort = effortLevels.includes(effort) ? effort : (effortLevels[0] ?? "");

  // 从最后一手派生胜负（moves 只追加/重置，无需额外状态）
  const win = useMemo<WinInfo | null>(() => {
    if (moves.length === 0) return null;
    const last = moves[moves.length - 1];
    return findWin(applyMoves(moves), last.row, last.col);
  }, [moves]);

  const ended = win !== null || draw;
  const humanTurn = phase === "playing" && !ended && turn === humanColor;

  // 记录滚到最新一手；思维链贴底跟随
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [moves.length]);
  useEffect(() => {
    const el = thinkRef.current;
    if (el && stickBottom.current) el.scrollTo({ top: el.scrollHeight });
  }, [aiThinkingText]);

  const resetGame = () => {
    gameToken.current++;
    requestedAt.current = -1;
    stickBottom.current = true;
    setMoves([]);
    resetThink();
    setAiSpeech("");
    setAiError("");
    setAiBusy(false);
  };

  const startGame = () => {
    if (!selectedModel) return;
    resetGame();
    setPhase("playing");
  };

  const handleCellClick = (row: number, col: number) => {
    if (!humanTurn || aiBusy) return;
    if (applyMoves(moves)[row][col]) return;
    setMoves((prev) => [...prev, { row, col, stone: humanColor }]);
  };

  const canUndo = phase === "playing" && !ended && !aiBusy && turn === humanColor && moves.length >= 2;
  const undo = () => {
    if (!canUndo) return;
    gameToken.current++;
    requestedAt.current = -1;
    stickBottom.current = true;
    setMoves((prev) => prev.slice(0, Math.max(0, prev.length - 2)));
    resetThink();
    setAiSpeech("");
    setAiError("");
  };

  const retryAiMove = () => {
    requestedAt.current = -1;
    stickBottom.current = true;
    setAiError("");
    setRetryNonce((n) => n + 1);
  };

  // AI 回合：流式请求落子（思维链边到边显；requestedAt 防止同一局面重复请求）
  useEffect(() => {
    if (phase !== "playing" || ended || turn !== aiColor || !effectiveModelId) return;
    if (requestedAt.current === moves.length) return;
    requestedAt.current = moves.length;
    const token = gameToken.current;
    setAiBusy(true);
    setAiError("");
    setAiSpeech("");
    stickBottom.current = true;
    // 新一轮思考入列；同一手重试则丢弃未完成的上一轮。
    // 展示总量超限时整轮裁掉最老的，但保底最近 THINK_MIN_ROUNDS 轮完整思考
    const rounds = thinkRounds.current;
    const ply = moves.length + 1;
    if (rounds.length > 0 && rounds[rounds.length - 1].ply === ply) rounds.pop();
    rounds.push({ ply, label: `── 第 ${ply} 手 ──`, text: "" });
    let keep = rounds.reduce((sum, r) => sum + r.text.length, 0);
    while (rounds.length - 1 > THINK_MIN_ROUNDS && keep > THINK_KEEP_CHARS) {
      keep -= rounds[0].text.length;
      rounds.shift();
      thinkDropped.current++;
    }
    scheduleThinkFlush();
    (async () => {
      try {
        const res = await fetch("/api/games/gomoku/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelId: effectiveModelId,
            aiColor,
            effort: effectiveEffort || undefined,
            thinking: aiThinking,
            speech: speechOn,
            moves: moves.map(({ row, col }) => ({ row, col })),
          }),
        });
        // 参数校验失败等仍是普通 JSON 错误
        const ct = res.headers.get("content-type") ?? "";
        if (!res.ok || ct.includes("application/json")) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          if (gameToken.current !== token) return;
          setAiBusy(false);
          setAiError(data?.error ?? `请求失败（HTTP ${res.status}）`);
          return;
        }
        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let move: { row: number; col: number } | null = null;
        let speechText = "";
        let errMsg = "";
        const handleEvent = (ev: StreamEvent) => {
          // 请求已失效（重开/悔棋后又开局）时丢弃迟到事件，避免污染新一轮思考
          if (gameToken.current !== token) return;
          if (ev.type === "thinking") appendThink(ev.delta);
          else if (ev.type === "notice") appendThink(`\n\n—— ${ev.text} ——\n`);
          else if (ev.type === "move") {
            move = ev.move;
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
          // 悔棋/重开让位：中断读取，丢弃后续事件
          if (gameToken.current !== token) {
            reader.cancel().catch(() => {});
            return;
          }
        }
        if (gameToken.current !== token) return;
        setAiBusy(false);
        if (errMsg) {
          setAiError(errMsg);
          return;
        }
        if (!move) {
          setAiError("连接中断，请重试");
          return;
        }
        const { row, col } = move;
        setAiSpeech(speechText);
        setMoves((prev) => [...prev, { row, col, stone: aiColor }]);
      } catch {
        if (gameToken.current === token) {
          setAiBusy(false);
          setAiError("网络请求失败，请重试");
        }
      }
    })();
  }, [phase, ended, turn, aiColor, effectiveModelId, moves, effectiveEffort, aiThinking, speechOn, retryNonce, appendThink, scheduleThinkFlush]);

  const status = (() => {
    if (!isModelsLoaded()) return { title: "加载模型列表中…", sub: "" };
    if (phase === "setup") {
      return models.length === 0
        ? { title: "还没有对手", sub: "先去模型配置页请一位选手上场" }
        : { title: "准备开局", sub: "选好对手和棋子颜色，按「开始对局」" };
    }
    if (!selectedModel) return { title: "对手不见了", sub: "模型配置被删除，请回设置重选" };
    if (win)
      return win.stone === humanColor
        ? { title: "五连达成，你赢了！", sub: "漂亮的胜利" }
        : { title: "你输了…", sub: `${selectedModel.name} 先连成了五子` };
    if (draw) return { title: "平局", sub: "棋盘上已经没有空位了" };
    // 轮到 AI 但请求还没发出（同一帧）也按思考中显示，避免状态行高度跳变带得棋盘缩放
    if (aiBusy || (turn === aiColor && !aiError))
      return { title: `${selectedModel.name} 正在思考`, sub: "思维链会在右侧同步展示" };
    if (turn === humanColor)
      return {
        title: "轮到你了",
        sub: `你执${humanColor === "black" ? "黑（先行）" : "白（后行）"}，点击棋盘落子`,
      };
    return { title: "等待中", sub: "" };
  })();

  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <SiteNav />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pt-3 pb-2 lg:h-[calc(100dvh-3.5rem)] lg:overflow-hidden">
        {/* 漫画封面式标题：纸底墨字 + 五连标记 + 印章（紧凑，整局控制在首屏内） */}
        <section className="relative shrink-0 overflow-hidden rounded-[10px] border-[3px] border-[#141414] bg-[#F7F0DF] text-[#141414] shadow-[5px_5px_0_rgba(0,0,0,0.55)]">
          <div className="pointer-events-none absolute inset-[5px] rounded-[6px] border border-[#141414]/30" aria-hidden />
          <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black tracking-[0.4em] text-[#C0392B]">
                GOMOKU · 人机对战
              </p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
                <h1 className="text-2xl font-black tracking-wide text-[#141414] sm:text-3xl">
                  五子棋
                </h1>
                <p className="text-xs font-medium text-neutral-600">横竖斜先连成五子者胜</p>
              </div>
            </div>
            <GomokuMark className="-rotate-3" />
            <StampBadge className="border-[#C0392B] bg-[#C0392B] text-[#F7F0DF]">
              {phase === "setup" ? "准备中" : ended ? "终局" : "对局中"}
            </StampBadge>
          </div>
        </section>

        <section className="mt-3 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[minmax(0,1fr)]">
          {/* 左：棋盘 + 状态（棋盘按剩余高度缩放，始终为正方形） */}
          <div className="flex min-h-0 flex-col">
            <div className="relative flex min-h-0 flex-1 items-center justify-center">
              <InkPanel className="relative mx-auto aspect-square w-full overflow-hidden lg:h-full lg:w-auto lg:max-w-full">
                <GomokuBoard
                  moves={moves}
                  winInfo={win}
                  interactive={humanTurn && !aiBusy}
                  previewStone={humanTurn ? humanColor : null}
                  onCellClick={handleCellClick}
                />

                {phase === "playing" && ended && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#141414]/25 backdrop-blur-[1.5px]">
                    <div className="relative w-[300px] max-w-[86%]">
                      <div className="absolute -inset-12">
                        <SpeedLines seed={11} />
                      </div>
                      <div className="relative -rotate-2 rounded-[6px] border-[4px] border-[#141414] bg-[#F7F0DF] px-6 py-6 text-center shadow-[8px_8px_0_#141414]">
                        <p className="text-xs font-black tracking-[0.5em] text-[#C0392B]">
                          咚咚咚…！
                        </p>
                        <h2 className="mt-2 text-3xl font-black text-[#141414]">
                          {win ? (win.stone === humanColor ? "你赢了！" : "你输了…") : "平局"}
                        </h2>
                        <p className="mt-1 text-xs text-neutral-600">{status.sub}</p>
                        <button
                          onClick={startGame}
                          className="mt-4 rounded-lg border-[3px] border-[#141414] bg-amber-400 px-5 py-2 text-sm font-black text-[#141414] shadow-[3px_3px_0_#141414] transition-transform hover:-translate-y-0.5"
                        >
                          再来一局
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </InkPanel>

              {/* 落子失败浮层：盖在棋盘上，不参与布局（棋盘尺寸不跳） */}
              {aiError && (
                <div className="absolute bottom-4 left-1/2 z-20 w-[min(92%,400px)] -translate-x-1/2 rounded-lg border-[3px] border-[#C0392B] bg-[#F7F0DF] px-4 py-3 text-sm text-[#C0392B] shadow-[5px_5px_0_rgba(0,0,0,0.35)]">
                  <p className="font-bold">AI 落子失败：{aiError}</p>
                  <button
                    onClick={retryAiMove}
                    className="mt-2 rounded-md border-2 border-[#C0392B] px-3 py-1 text-xs font-bold transition-colors hover:bg-[#C0392B] hover:text-white"
                  >
                    重试这一手
                  </button>
                </div>
              )}
            </div>

            <div className="mt-3 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-start">
              <SpeechBubble className="min-w-0 flex-1">
                {/* ＞＞＞ 放在标题行内：独立成行会撑高气泡，带得棋盘缩放 */}
                <p className="text-sm font-black">
                  {status.title}
                  {aiBusy && (
                    <span className="ml-1 inline-block animate-pulse font-black" aria-hidden>
                      ＞＞＞
                    </span>
                  )}
                </p>
                {/* 副行常驻占位：内容为空时也保留行高，避免状态切换带得棋盘缩放 */}
                <p className="mt-0.5 text-xs text-neutral-600">{status.sub || "\u00A0"}</p>
              </SpeechBubble>
              <div className="flex gap-2 sm:pt-1">
                <button onClick={undo} disabled={!canUndo} className={`${inkBtn} bg-white`}>
                  悔棋
                </button>
                <button onClick={resetGame} disabled={phase !== "playing"} className={`${inkBtn} bg-amber-400`}>
                  重新开局
                </button>
              </div>
            </div>
          </div>

          {/* 右：设置 / 对手 / 思维链 / 记录（思维链与记录只在对局中显示） */}
          <aside className="flex flex-col gap-3 lg:min-h-0">
            <InkPanel className="p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-black">对局设置</h2>
                <span className="text-[10px] font-bold tracking-[0.25em] text-neutral-500">
                  SETTINGS
                </span>
              </div>

              {phase === "setup" ? (
                <div className="mt-3 space-y-3">
                  {!isModelsLoaded() ? (
                    <p className="text-sm text-neutral-500">加载模型中…</p>
                  ) : models.length === 0 ? (
                    <div className="text-sm text-neutral-600">
                      还没有可选的对手。
                      <Link
                        href="/models"
                        className="font-bold text-[#B45309] underline underline-offset-2"
                      >
                        去模型配置页添加 →
                      </Link>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label htmlFor="gomoku-model" className="text-xs font-bold text-neutral-600">
                          你的对手
                        </label>
                        <select
                          id="gomoku-model"
                          value={effectiveModelId}
                          onChange={(e) => setModelId(e.target.value)}
                          className="mt-1 w-full rounded-lg border-[2.5px] border-[#141414] bg-white px-3 py-2 text-sm font-medium outline-none"
                        >
                          {models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <p className="text-xs font-bold text-neutral-600">你的棋子</p>
                        <div className="mt-1 grid grid-cols-2 gap-2">
                          {(["black", "white"] as const).map((color) => {
                            const active = humanColor === color;
                            return (
                              <button
                                key={color}
                                type="button"
                                aria-pressed={active}
                                onClick={() => setHumanColor(color)}
                                className={`rounded-lg border-[3px] border-[#141414] px-3 py-2 text-sm font-bold shadow-[3px_3px_0_#141414] transition-transform hover:-translate-y-0.5 ${
                                  active ? "bg-amber-400" : "bg-white"
                                }`}
                              >
                                {color === "black" ? "● 黑棋 · 先行" : "○ 白棋 · 后行"}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {selectedModel?.thinkingEnabled && (
                        <div>
                          <p className="text-xs font-bold text-neutral-600">⚡ 思考</p>
                          <div className="mt-1 flex items-center justify-between rounded-lg border-[2.5px] border-[#141414] bg-white px-3 py-1.5">
                            <span className="text-sm font-medium text-neutral-600">
                              {thinkingOn ? "对局中思考" : "直接落子"}
                            </span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={thinkingOn}
                              aria-label="思考开关"
                              onClick={() => setThinkingOn((v) => !v)}
                              className={`relative h-6 w-11 shrink-0 rounded-full border-[2.5px] border-[#141414] transition-colors ${
                                thinkingOn ? "bg-amber-400" : "bg-neutral-300"
                              }`}
                            >
                              <span
                                className={`absolute left-[3px] top-1/2 size-4 -translate-y-1/2 rounded-full bg-white shadow transition-transform ${
                                  thinkingOn ? "translate-x-[20px]" : "translate-x-0"
                                }`}
                              />
                            </button>
                          </div>
                        </div>
                      )}

                      <div>
                        <p className="text-xs font-bold text-neutral-600">💬 说话</p>
                        <div className="mt-1 flex items-center justify-between rounded-lg border-[2.5px] border-[#141414] bg-white px-3 py-1.5">
                          <span className="text-sm font-medium text-neutral-600">
                            {speechOn ? "落子后说一句" : "保持沉默"}
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={speechOn}
                            aria-label="说话开关"
                            onClick={() => setSpeechOn((v) => !v)}
                            className={`relative h-6 w-11 shrink-0 rounded-full border-[2.5px] border-[#141414] transition-colors ${
                              speechOn ? "bg-amber-400" : "bg-neutral-300"
                            }`}
                          >
                            <span
                              className={`absolute left-[3px] top-1/2 size-4 -translate-y-1/2 rounded-full bg-white shadow transition-transform ${
                                speechOn ? "translate-x-[20px]" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                      </div>

                      {aiThinking && effortLevels.length > 0 && (
                        <div>
                          <label htmlFor="gomoku-effort" className="text-xs font-bold text-neutral-600">
                            推理档位
                          </label>
                          <select
                            id="gomoku-effort"
                            value={effectiveEffort}
                            onChange={(e) => setEffort(e.target.value)}
                            className="mt-1 w-full rounded-lg border-[2.5px] border-[#141414] bg-white px-3 py-2 font-mono text-sm outline-none"
                          >
                            {effortLevels.map((level) => (
                              <option key={level} value={level}>
                                {level}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <button
                        onClick={startGame}
                        className={`${inkBtn} w-full bg-amber-400 py-2.5 text-center`}
                      >
                        开始对局
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="mt-3 space-y-3 text-sm">
                  <dl className="space-y-1.5">
                    <div className="flex justify-between gap-2">
                      <dt className="text-neutral-600">你执</dt>
                      <dd className="font-bold">{humanColor === "black" ? "● 黑（先行）" : "○ 白（后行）"}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-neutral-600">AI 执</dt>
                      <dd className="font-bold">{aiColor === "black" ? "● 黑" : "○ 白"}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-neutral-600">思考</dt>
                      <dd className="font-mono text-xs font-bold">
                        {aiThinking
                          ? effortLevels.length
                            ? `开 · ${effectiveEffort}`
                            : "开"
                          : "关"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-neutral-600">说话</dt>
                      <dd className="font-mono text-xs font-bold">{speechOn ? "开" : "关"}</dd>
                    </div>
                  </dl>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button onClick={resetGame} className={`${inkBtn} bg-amber-400`}>
                      重新开局
                    </button>
                    <button
                      onClick={() => {
                        resetGame();
                        setPhase("setup");
                      }}
                      className={`${inkBtn} bg-white`}
                    >
                      回设置
                    </button>
                  </div>
                </div>
              )}
            </InkPanel>

            {selectedModel && (
              <InkPanel className="relative shrink-0 overflow-hidden p-4">
                <Halftone className="bottom-0 right-0 h-20 w-24" id="ht-player" opacity={0.15} />
                <div className="relative flex items-center gap-3">
                  <div className="shrink-0 rounded-full border-[3px] border-[#141414] bg-white p-0.5 shadow-[3px_3px_0_#141414]">
                    <Avatar
                      name={selectedModel.name}
                      src={selectedModel.avatar || undefined}
                      className="size-14"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-base font-black">{selectedModel.name}</p>
                    <p className="truncate font-mono text-[11px] text-neutral-600">
                      {selectedModel.modelId}
                    </p>
                    <span className="mt-1 inline-block rounded-full border-2 border-[#141414] bg-white px-2 py-0.5 text-[10px] font-bold">
                      {protocolMeta(selectedModel.protocol).label}
                    </span>
                  </div>
                </div>

                {/* 台词气泡：说话开启时模型落子后的一句感言。
                    line-clamp-3 兜底：台词过长时最多三行省略号，悬停看全文，不撑坏布局 */}
                {aiSpeech && (
                  <SpeechBubble className="relative mt-3">
                    <p
                      className="line-clamp-3 break-words text-sm font-bold leading-relaxed"
                      title={aiSpeech}
                    >
                      {aiSpeech}
                    </p>
                  </SpeechBubble>
                )}
              </InkPanel>
            )}

            {phase === "playing" && (
              <InkPanel className="flex min-h-0 flex-1 flex-col p-4">
                <h2 className="text-base font-black">AI 思维链</h2>
                <div
                  ref={thinkRef}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
                  }}
                  className="mt-2 min-h-0 max-h-48 flex-1 overflow-auto rounded-lg border-2 border-[#141414]/20 bg-white/70 p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap lg:max-h-none"
                >
                  {aiThinkingText || "（这一手还没有收到思维链）"}
                </div>
              </InkPanel>
            )}

            {phase === "playing" && (
              <InkPanel className="flex min-h-0 flex-1 flex-col p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-black">落子记录</h2>
                  <span className="text-xs font-bold text-neutral-500">{moves.length} 手</span>
                </div>
                <div ref={logRef} className="mt-2 min-h-0 max-h-48 flex-1 space-y-1 overflow-auto pr-1 lg:max-h-none">
                  {moves.length === 0 ? (
                    <p className="text-xs text-neutral-500">还没有落子</p>
                  ) : (
                    moves.map((m, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className="w-7 text-right font-mono text-xs text-neutral-500">
                          {i + 1}.
                        </span>
                        <span aria-hidden>{m.stone === "black" ? "●" : "○"}</span>
                        <span className="font-mono text-xs font-bold">{cellName(m.row, m.col)}</span>
                        <span className="ml-auto text-[10px] text-neutral-500">
                          {m.stone === humanColor ? "你" : selectedModel?.name}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </InkPanel>
            )}
          </aside>
        </section>
      </main>
    </div>
  );
}
