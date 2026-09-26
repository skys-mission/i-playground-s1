import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";

const MORE_GAMES = ["辩论对决", "抢答竞速", "角色扮演", "策略博弈"];

/** 五连标记：标题旁的小签名 */
function GomokuMark({ className = "" }: { className?: string }) {
  const pts = [0, 1, 2, 3, 4].map((i) => ({ x: 26 + i * 58, y: 64 - i * 7 }));
  const last = pts[4];
  return (
    <svg viewBox="0 0 290 88" className={`block h-10 w-auto select-none ${className}`} aria-hidden>
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

/** 目录行：棋子符号 + 名称 + 一句话 + 箭头，整行可点 */
function EntryRow({
  href,
  glyph,
  title,
  desc,
}: {
  href: string;
  glyph?: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 border-t-[2.5px] border-[#141414]/15 px-2 py-4 transition-colors hover:bg-amber-200/50 sm:px-3"
    >
      {glyph && (
        <span aria-hidden className="w-6 shrink-0 text-center text-xl font-black leading-none">
          {glyph}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-base font-black">{title}</span>
        <span className="mt-0.5 block text-sm leading-relaxed text-neutral-600">{desc}</span>
      </span>
      <span
        aria-hidden
        className="shrink-0 font-black text-[#141414]/40 transition-all group-hover:translate-x-1 group-hover:text-[#C0392B]"
      >
        →
      </span>
    </Link>
  );
}

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-[#F7F0DF] text-[#141414]">
      <SiteNav />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-12 pt-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight sm:text-5xl">AI 竞技游乐场</h1>
            <p className="mt-3 text-sm text-neutral-600">把模型请上场，挑一场对局。</p>
          </div>
          <GomokuMark className="hidden shrink-0 rotate-2 sm:block" />
        </div>

        <section className="mt-10">
          <h2 className="text-[10px] font-black tracking-[0.35em] text-neutral-500">
            游戏 · GAMES
          </h2>
          <div className="mt-3 border-y-[3px] border-[#141414]">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-2 pb-1.5 pt-3.5 sm:px-3">
              <p className="text-lg font-black">五子棋</p>
              <p className="text-xs text-neutral-500">横竖斜先连成五子者胜</p>
            </div>
            <EntryRow
              href="/games/gomoku"
              glyph="●"
              title="人机对战"
              desc="亲自下场，和模型下一盘"
            />
            <EntryRow
              href="/games/gomoku/arena"
              glyph="○"
              title="AI 对战"
              desc="两位 AI 对弈，围观双方的台词与思维链"
            />
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-[10px] font-black tracking-[0.35em] text-neutral-500">
            配置 · SETUP
          </h2>
          <div className="mt-3 border-y-[3px] border-[#141414]">
            <EntryRow
              href="/models"
              title="模型配置"
              desc="接入模型选手：名称、模型 ID、Base URL、API Key"
            />
          </div>
        </section>

        <p className="mt-8 text-xs text-neutral-500">
          更多玩法即将登场：{MORE_GAMES.join(" · ")}
        </p>
      </main>
    </div>
  );
}
