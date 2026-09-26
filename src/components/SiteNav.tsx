"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type NavChild = { href: string; label: string };
type NavItem = { href: string; label: string; children?: NavChild[] };

const LINKS: NavItem[] = [
  { href: "/", label: "主页" },
  {
    href: "/games/gomoku",
    label: "五子棋",
    children: [
      { href: "/games/gomoku", label: "人机对战" },
      { href: "/games/gomoku/arena", label: "AI 对战" },
    ],
  },
  { href: "/models", label: "模型配置" },
];

// /games/gomoku 是 /games/gomoku/arena 的前缀，须先排除 arena 再匹配五子棋·人机
function isActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  if (href === "/games/gomoku")
    return pathname.startsWith(href) && !pathname.startsWith("/games/gomoku/arena");
  return pathname.startsWith(href);
}

const idleCls =
  "text-[#141414]/60 transition-colors hover:bg-amber-200/60 hover:text-[#141414]";
const activeCls = "bg-amber-300 text-[#141414]";

export function SiteNav() {
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  return (
    <header className="sticky top-0 z-40 border-b-[3px] border-[#141414] bg-[#F7F0DF]">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-lg font-black tracking-tight text-[#141414]"
        >
          <span aria-hidden>🎪</span>
          <span>AI 竞技游乐场</span>
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.map((link) => {
            if (!link.children) {
              const active = isActive(link.href, pathname);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-lg px-3 py-1.5 text-sm font-bold ${
                    active ? activeCls : idleCls
                  }`}
                >
                  {link.label}
                </Link>
              );
            }
            const groupActive = link.children.some((c) => isActive(c.href, pathname));
            const open = openMenu === link.href;
            return (
              <div
                key={link.href}
                className="relative"
                onMouseEnter={() => setOpenMenu(link.href)}
                onMouseLeave={() => setOpenMenu((m) => (m === link.href ? null : m))}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  aria-haspopup="menu"
                  onClick={() => setOpenMenu(link.href)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold ${
                    groupActive ? activeCls : idleCls
                  }`}
                >
                  {link.label}
                  <svg
                    aria-hidden
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    className={`transition-transform ${open ? "rotate-180" : ""}`}
                  >
                    <path
                      d="M2 3.5 L5 6.5 L8 3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                {open && (
                  <div className="absolute right-0 top-full mt-1.5 min-w-40 overflow-hidden rounded-[10px] border-[3px] border-[#141414] bg-[#F7F0DF] py-1.5 shadow-[4px_4px_0_#141414]">
                    {link.children.map((child) => {
                      const childActive = isActive(child.href, pathname);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={() => setOpenMenu(null)}
                          className={`block px-4 py-1.5 text-sm font-bold ${
                            childActive ? activeCls : idleCls
                          }`}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
