"use client";

import { useMemo, useRef, useState } from "react";
import {
  BOARD_SIZE,
  COLUMN_LABELS,
  applyMoves,
  type Move,
  type Stone,
  type WinInfo,
} from "@/lib/gomoku";

/** 漫画墨线风格的 SVG 五子棋棋盘：网格、星位、坐标、悬停预览、胜利连线 */

const CELL = 34;
const PAD = 30;
const SIZE = PAD * 2 + CELL * (BOARD_SIZE - 1);
const STONE_R = 14.5;

/** 星位（天元 + 四角星） */
const STARS: [number, number][] = [
  [3, 3],
  [3, 11],
  [11, 3],
  [11, 11],
  [7, 7],
];

const cx = (col: number) => PAD + col * CELL;
const cy = (row: number) => PAD + row * CELL;

export function GomokuBoard({
  moves,
  winInfo,
  interactive,
  previewStone,
  onCellClick,
}: {
  moves: Move[];
  winInfo: WinInfo | null;
  interactive: boolean;
  /** 悬停预览显示的棋子颜色（轮到谁） */
  previewStone: Stone | null;
  onCellClick: (row: number, col: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  const board = useMemo(() => applyMoves(moves), [moves]);

  /** 视口坐标 → 交叉点下标（响应式缩放无关） */
  const pointToCell = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = ((e.clientX - rect.left) / rect.width) * SIZE;
    const y = ((e.clientY - rect.top) / rect.height) * SIZE;
    const col = Math.round((x - PAD) / CELL);
    const row = Math.round((y - PAD) / CELL);
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return null;
    return { row, col };
  };

  const gridLines = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const p = PAD + i * CELL;
    gridLines.push(
      <line key={`h${i}`} x1={PAD} y1={p} x2={SIZE - PAD} y2={p} stroke="#141414" strokeWidth={1.3} />,
      <line key={`v${i}`} x1={p} y1={PAD} x2={p} y2={SIZE - PAD} stroke="#141414" strokeWidth={1.3} />,
    );
  }

  const coordText = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const p = PAD + i * CELL;
    coordText.push(
      <text key={`ct${i}`} x={p} y={PAD - 13} textAnchor="middle" fontSize={11} fill="#8a7f6a" fontFamily="ui-monospace, monospace">
        {COLUMN_LABELS[i]}
      </text>,
      <text key={`cb${i}`} x={p} y={SIZE - PAD + 21} textAnchor="middle" fontSize={11} fill="#8a7f6a" fontFamily="ui-monospace, monospace">
        {COLUMN_LABELS[i]}
      </text>,
      <text key={`rl${i}`} x={PAD - 16} y={p + 4} textAnchor="middle" fontSize={11} fill="#8a7f6a" fontFamily="ui-monospace, monospace">
        {i + 1}
      </text>,
      <text key={`rr${i}`} x={SIZE - PAD + 16} y={p + 4} textAnchor="middle" fontSize={11} fill="#8a7f6a" fontFamily="ui-monospace, monospace">
        {i + 1}
      </text>,
    );
  }

  const hoverEmpty =
    interactive && hover && !board[hover.row][hover.col] ? hover : null;
  const winCellSet = new Set((winInfo?.cells ?? []).map(([r, c]) => r * BOARD_SIZE + c));

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="block h-auto w-full select-none"
      style={{ cursor: interactive ? "pointer" : "default" }}
      role="grid"
      aria-label="五子棋棋盘"
      onPointerMove={(e) => {
        if (!interactive) return;
        setHover(pointToCell(e));
      }}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => {
        const cell = pointToCell(e);
        if (cell) onCellClick(cell.row, cell.col);
      }}
    >
      {/* 纸面 */}
      <rect x="0" y="0" width={SIZE} height={SIZE} fill="#F5EDD8" />

      {/* 网格与外框 */}
      {gridLines}
      <rect
        x={PAD}
        y={PAD}
        width={SIZE - PAD * 2}
        height={SIZE - PAD * 2}
        fill="none"
        stroke="#141414"
        strokeWidth={2.8}
      />

      {/* 星位 */}
      {STARS.map(([r, c]) => (
        <circle key={`star${r}-${c}`} cx={cx(c)} cy={cy(r)} r={3.2} fill="#141414" />
      ))}

      {/* 坐标 */}
      {coordText}

      {/* 胜利连线：琥珀主线上压一层墨色衬底 */}
      {winInfo && winInfo.cells.length > 0 && (
        <line
          x1={cx(winInfo.cells[0][1])}
          y1={cy(winInfo.cells[0][0])}
          x2={cx(winInfo.cells[winInfo.cells.length - 1][1])}
          y2={cy(winInfo.cells[winInfo.cells.length - 1][0])}
          stroke="#141414"
          strokeWidth={9.5}
          strokeLinecap="round"
          opacity={0.18}
        />
      )}
      {winInfo && winInfo.cells.length > 0 && (
        <line
          x1={cx(winInfo.cells[0][1])}
          y1={cy(winInfo.cells[0][0])}
          x2={cx(winInfo.cells[winInfo.cells.length - 1][1])}
          y2={cy(winInfo.cells[winInfo.cells.length - 1][0])}
          stroke="#F59E0B"
          strokeWidth={7}
          strokeLinecap="round"
          className="animate-pulse"
        />
      )}

      {/* 棋子：黑 = 墨块 + 白弧高光，白 = 纸白 + 墨框 + 底部阴影弧 */}
      {moves.map((m, i) => {
        const x = cx(m.col);
        const y = cy(m.row);
        const isLast = i === moves.length - 1;
        const isWin = winCellSet.has(m.row * BOARD_SIZE + m.col);
        return (
          <g key={`${m.row}-${m.col}`}>
            {m.stone === "black" ? (
              <>
                <circle cx={x} cy={y} r={STONE_R} fill="#141414" />
                <path
                  d={`M ${x - 7} ${y - 5} a 9.5 9.5 0 0 1 6.5 -4.5`}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  opacity={0.6}
                />
              </>
            ) : (
              <>
                <circle cx={x} cy={y} r={STONE_R} fill="#FFFDF6" stroke="#141414" strokeWidth={2.4} />
                <path
                  d={`M ${x + 2.5} ${y + 8.5} a 11.5 11.5 0 0 0 8.5 -5`}
                  fill="none"
                  stroke="#CFC4A6"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  opacity={0.9}
                />
              </>
            )}
            {isWin && (
              <circle cx={x} cy={y} r={STONE_R + 2.6} fill="none" stroke="#F59E0B" strokeWidth={2.6} />
            )}
            {isLast && !winInfo && (
              <circle cx={x} cy={y} r={4.2} fill="#F59E0B" stroke="#141414" strokeWidth={1} />
            )}
          </g>
        );
      })}

      {/* 悬停预览：虚线幽灵子 */}
      {hoverEmpty && previewStone && (
        <circle
          cx={cx(hoverEmpty.col)}
          cy={cy(hoverEmpty.row)}
          r={STONE_R}
          fill={previewStone === "black" ? "#141414" : "#FFFDF6"}
          opacity={0.4}
          stroke="#141414"
          strokeWidth={1.6}
          strokeDasharray="4 3"
        />
      )}
    </svg>
  );
}
