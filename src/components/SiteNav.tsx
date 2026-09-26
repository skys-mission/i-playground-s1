"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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

function NavMenu({ item, pathname }: { item: NavItem; pathname: string }) {
  const [open, setOpen] = useState(false);
  // 移出后延迟收起：指针斜向移往比按钮更宽的菜单途中会短暂出界，立刻收起就永远选不中
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  };
  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const groupActive = item.children!.some((c) => isActive(c.href, pathname));

  return (
    <div
      className="relative"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold ${
          groupActive ? activeCls : idleCls
        }`}
      >
        {item.label}
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
        // pt-1.5 是悬浮桥接区：把按钮与菜单之间的缝隙纳入可悬停范围；换成 mt-1.5 会让指针一过缝隙菜单就关闭
        <div className="absolute right-0 top-full min-w-40 pt-1.5">
          <div className="overflow-hidden rounded-[10px] border-[3px] border-[#141414] bg-[#F7F0DF] py-1.5 shadow-[4px_4px_0_#141414]">
            {item.children!.map((child) => {
              const childActive = isActive(child.href, pathname);
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  onClick={() => setOpen(false)}
                  className={`block px-4 py-1.5 text-sm font-bold ${
                    childActive ? activeCls : idleCls
                  }`}
                >
                  {child.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function SiteNav() {
  const pathname = usePathname();

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
            return <NavMenu key={link.href} item={link} pathname={pathname} />;
          })}
        </nav>
      </div>
    </header>
  );
}
