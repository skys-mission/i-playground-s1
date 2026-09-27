import type { ReactNode } from "react";

/** 日漫画风基础元素：墨色、纸色与漫画装饰组件（纯展示，无客户端状态） */

export const INK = "#141414";
export const PAPER = "#F7F0DF";
/** 印章/胜负点缀用的暖红（非蓝紫、非渐变） */
export const VERMILION = "#C0392B";

/** 简单可复现的伪随机（集中线用，避免每次渲染抖动） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 集中线：从中心放射的线束，铺满父容器（父容器需 relative）。深色底传纸色线。
 *  preserveAspectRatio="none" 让放射随容器拉伸：宽横幅里自然变成水平向的漫画集中线。
 *  坐标经 toFixed(2) 量化：Math.cos/sin 在服务端 V8 与客户端 WebKit 可能有末位差异，
 *  量化后字符串一致，避免 SSR 水合报错 */
export function SpeedLines({
  className = "",
  seed = 7,
  count = 64,
  stroke = INK,
}: {
  className?: string;
  seed?: number;
  count?: number;
  stroke?: string;
}) {
  const rand = mulberry32(seed);
  const lines = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rand() * 0.1;
    const r1 = 20 + rand() * 28;
    const r2 = 48 + rand() * 52;
    lines.push(
      <line
        key={i}
        x1={(50 + Math.cos(angle) * r1).toFixed(2)}
        y1={(50 + Math.sin(angle) * r1).toFixed(2)}
        x2={(50 + Math.cos(angle) * r2).toFixed(2)}
        y2={(50 + Math.sin(angle) * r2).toFixed(2)}
        stroke={stroke}
        strokeWidth={(0.35 + rand() * 0.75).toFixed(2)}
        strokeLinecap="round"
        opacity={(0.35 + rand() * 0.5).toFixed(2)}
      />,
    );
  }
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      aria-hidden
    >
      {lines}
    </svg>
  );
}

/** 平行排线：等间距斜线铺满父容器（父容器需 relative）。深色底传纸色线。
 *  纯整数百分比坐标 + 描边不随缩放：任意宽高比下线条都保持平行、粗细一致，
 *  也天然跨引擎确定（无浮点三角函数），可安全用于 SSR */
export function Stripes({
  className = "",
  stroke = PAPER,
  gap = 16,
  width = 2,
}: {
  className?: string;
  stroke?: string;
  /** 相邻斜线的水平间距（容器宽度的百分比） */
  gap?: number;
  width?: number;
}) {
  const lines = [];
  for (let x = -80; x <= 180; x += gap) {
    lines.push(
      <line
        key={x}
        x1={`${x}%`}
        y1="0%"
        x2={`${x + 45}%`}
        y2="100%"
        stroke={stroke}
        strokeWidth={width}
        vectorEffect="non-scaling-stroke"
      />,
    );
  }
  return (
    <svg
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      aria-hidden
    >
      {lines}
    </svg>
  );
}

/** 网点（半调）：漫画式圆点纹理块 */
export function Halftone({
  className = "",
  id = "manga-halftone",
  opacity = 0.5,
}: {
  className?: string;
  id?: string;
  opacity?: number;
}) {
  return (
    <svg className={`pointer-events-none absolute ${className}`} aria-hidden>
      <defs>
        <pattern id={id} width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.35" fill={INK} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} opacity={opacity} />
    </svg>
  );
}

/** 漫画分格：纸底 + 粗墨边框 + 硬阴影 */
export function InkPanel({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-[10px] border-[3px] border-[#141414] bg-[#F7F0DF] text-[#141414] shadow-[6px_6px_0_#141414] ${className}`}
    >
      {children}
    </div>
  );
}

/** 对话气泡：白底墨框 + 尾巴 */
export function SpeechBubble({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative rounded-2xl border-[3px] border-[#141414] bg-white px-4 py-3 text-[#141414] ${className}`}
    >
      {children}
      <span
        className="absolute -bottom-[11px] left-8 size-5 rotate-45 border-b-[3px] border-r-[3px] border-[#141414] bg-white"
        aria-hidden
      />
    </div>
  );
}

/** 印章：旋转的暖红粗边框章 */
export function StampBadge({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-block -rotate-3 rounded-[5px] border-[3px] border-[#C0392B] px-3 py-1 text-sm font-black tracking-[0.3em] text-[#C0392B] ${className}`}
    >
      {children}
    </span>
  );
}
