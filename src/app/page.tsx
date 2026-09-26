import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";

const MORE_GAMES = ["辩论对决", "抢答竞速", "角色扮演", "策略博弈"];

export default function Home() {
  return (
    <div className="min-h-screen">
      <SiteNav />

      <main className="mx-auto max-w-5xl px-4 pb-20">
        {/* Hero */}
        <section className="py-16 text-center">
          <h1 className="text-5xl font-black tracking-tight">
            AI 竞技
            <span className="text-amber-400">游乐场</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-neutral-400">
            配置你的模型阵容，挑选一场对局。
            先从模型配置开始，把选手请上场。
          </p>
        </section>

        {/* 两大入口 */}
        <section className="grid gap-4 md:grid-cols-2">
          {/* 模型配置：可用入口 */}
          <Link
            href="/models"
            className="group relative overflow-hidden rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-6 transition-colors hover:border-amber-400/60"
          >
            <div className="text-4xl" aria-hidden>
              🤖
            </div>
            <h2 className="mt-4 text-xl font-bold">模型配置</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-400">
              以协议接入任意模型：OpenAI Chat Completions、OpenAI Responses、
              Anthropic Messages。只需名称、模型 ID、Base URL 与 API Key。
            </p>
            <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-amber-300">
              进入配置
              <span className="transition-transform group-hover:translate-x-1" aria-hidden>
                →
              </span>
            </span>
          </Link>

          {/* 五子棋：可用入口 */}
          <Link
            href="/games/gomoku"
            className="group relative overflow-hidden rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-6 transition-colors hover:border-amber-400/60"
          >
            <div className="flex items-start justify-between">
              <div className="text-4xl" aria-hidden>
                ⚫⚪
              </div>
              <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300 ring-1 ring-amber-400/30">
                首个玩法 · 可玩
              </span>
            </div>
            <h2 className="mt-4 text-xl font-bold">五子棋 · 人机对战</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-400">
              挑一位配置好的模型当对手，手绘漫画风棋盘上一决胜负。
              支持执黑/执白、悔棋与思维链围观。
            </p>
            <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-amber-300">
              进入对局
              <span className="transition-transform group-hover:translate-x-1" aria-hidden>
                →
              </span>
            </span>
            <p className="mt-4 border-t border-white/5 pt-3 text-xs text-neutral-600">
              更多玩法即将登场：
              {MORE_GAMES.map((name) => ` ${name}`).join(" ·")}
            </p>
          </Link>
        </section>
      </main>

      <footer className="border-t border-white/10 py-6 text-center text-xs text-neutral-600">
        AI 竞技游乐场 · 数据保存在本地 SQLite 数据库，密钥不会离开你的机器
      </footer>
    </div>
  );
}
