/** 五子棋（Gomoku）核心规则与文本协议：客户端棋盘渲染与服务端 AI 调用共用 */

export const BOARD_SIZE = 15;

/** 列标签：与提示词、棋盘坐标一致，A-O */
export const COLUMN_LABELS = "ABCDEFGHIJKLMNO";

export type Stone = "black" | "white";

export interface Move {
  row: number;
  col: number;
  stone: Stone;
}

export type Board = (Stone | null)[][];

export interface WinInfo {
  stone: Stone;
  /** 连成五子的全部交叉点 [row, col] */
  cells: [number, number][];
}

export function createBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () => Array<Stone | null>(BOARD_SIZE).fill(null));
}

/** 按落子顺序重建棋盘（黑先） */
export function applyMoves(moves: Move[]): Board {
  const board = createBoard();
  for (const { row, col, stone } of moves) {
    if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
      board[row][col] = stone;
    }
  }
  return board;
}

/** 交叉点名称，如 H8 */
export function cellName(row: number, col: number): string {
  return `${COLUMN_LABELS[col]}${row + 1}`;
}

const DIRECTIONS: [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/** 从最后一手出发判断胜负：返回连成五子的棋子与坐标，无胜负返回 null */
export function findWin(board: Board, row: number, col: number): WinInfo | null {
  const stone = board[row]?.[col];
  if (!stone) return null;
  for (const [dr, dc] of DIRECTIONS) {
    const cells: [number, number][] = [[row, col]];
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === stone) {
        if (sign === 1) cells.push([r, c]);
        else cells.unshift([r, c]);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (cells.length >= 5) return { stone, cells };
  }
  return null;
}

/** 棋盘渲染为文本（提示词用）：X=黑 O=白 .=空 */
export function boardToText(board: Board): string {
  const header = "   " + COLUMN_LABELS.split("").join(" ");
  const rows = board.map(
    (row, r) =>
      String(r + 1).padStart(2, " ") +
      " " +
      row.map((cell) => (cell === "black" ? "X" : cell === "white" ? "O" : ".")).join(" "),
  );
  return [header, ...rows].join("\n");
}

/** 落子历史渲染为文本（提示词用） */
export function movesToText(moves: Move[]): string {
  if (moves.length === 0) return "（空棋盘，你执先手）";
  return moves
    .map((m, i) => `${i + 1}. ${m.stone === "black" ? "黑X" : "白O"} ${cellName(m.row, m.col)}`)
    .join("\n");
}

/** 去掉本地部署常见的 <think>…</think> 包裹，再解析落子 */
export function stripThinkingTags(text: string): string {
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
}

/** 从模型回复中解析落子坐标（row/col 为 0 起始下标，越界由调用方校验） */
export function parseAiMove(text: string): { row: number; col: number } | null {
  const t = stripThinkingTags(text);

  // 首选：约定格式 MOVE H8 / MOVE: H8 / move h8
  let m = t.match(/MOVE\s*[:：]?\s*\(?\s*([A-Oa-o])\s*[,，]?\s*(\d{1,2})\s*\)?/);
  // 次选：裸坐标 H8（词边界内单字母 + 1~2 位数字）
  if (!m) m = t.match(/\b([A-Oa-o])\s*[-—]?\s*(\d{1,2})\b/);
  if (m) {
    const col = COLUMN_LABELS.indexOf(m[1].toUpperCase());
    const row = parseInt(m[2], 10) - 1;
    return { row, col };
  }

  // 兜底：数字坐标 (行, 列)，1 起始
  m = t.match(/[（(]\s*(\d{1,2})\s*[,，]\s*(\d{1,2})\s*[)）]/);
  if (m) {
    return { row: parseInt(m[1], 10) - 1, col: parseInt(m[2], 10) - 1 };
  }
  return null;
}
