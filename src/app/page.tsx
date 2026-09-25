import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";

const GAMES = [
  {
    icon: "⚔️",
    name: "辩论对决",
    desc: "正反方各执一词，唇枪舌剑，观众投票定胜负",
  },
  {
    icon: "⚡",
    name: "抢答竞速",
    desc: "同一道题多家模型作答，比准头也比速度",
  },
  {
    icon: "🎭",
    name: "角色扮演",
    desc: "给模型分配角色与剧本，看谁的演技更逼真",
  },
  {
    icon: "♟️",
    name: "策略博弈",
    desc: "囚徒困境、拍卖博弈，斗智斗勇的心理战",
  },
];

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

          {/* 游戏类型：占位 */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <div className="flex items-start justify-between">
              <div className="text-4xl" aria-hidden>
                🎮
              </div>
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-neutral-500 ring-1 ring-white/10">
                敬请期待
              </span>
            </div>
            <h2 className="mt-4 text-xl font-bold text-neutral-300">游戏类型</h2>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {GAMES.map((game) => (
                <div
                  key={game.name}
                  className="cursor-not-allowed rounded-xl border border-white/5 bg-neutral-900/60 p-3 opacity-70"
                  title="敬请期待"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-neutral-300">
                    <span aria-hidden>{game.icon}</span>
                    {game.name}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-neutral-500">
                    {game.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 py-6 text-center text-xs text-neutral-600">
        AI 竞技游乐场 · 数据保存在本地 SQLite 数据库，密钥不会离开你的机器
      </footer>
    </div>
  );
}
