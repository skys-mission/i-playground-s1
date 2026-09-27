/** Swap2 开局协议（竞技五子棋标准开局，用于消除黑棋先手优势）。
 *
 * 席位与颜色分离：a = 开局摆子方（暂定黑），b = 应对方（暂定白）。
 * 流程：
 *  1. a 代双方摆前三子（第1手黑、第2手白、第3手黑）——棋子颜色恒按手数奇偶交替；
 *  2. b 三选一：执白 / 换执黑 / 加摆两子（第4手白、第5手黑）；
 *  3. 若加摆两子，a 必须二选一定色（执黑 / 执白）；
 *  4. 定色后恒由执白一方落下一手（第 4 或第 6 手），此后正常对弈。
 *
 * 协议状态只记两次抉择，当前阶段由 moves 数量推导——悔棋回退棋谱
 * 不会破坏协议（开局阶段禁止悔棋，见调用方守卫）。 */

export type Seat = "a" | "b";

export type Swap2Choice = "black" | "white" | "place2";

export interface Swap2State {
  /** 应对方 b 的抉择；null = 尚未做出（还在摆前三子） */
  bChoice: Swap2Choice | null;
  /** 开局方 a 的定色（仅当 b 选择加摆两子后发生） */
  aChoice: "black" | "white" | null;
}

export const SWAP2_INITIAL: Swap2State = { bChoice: null, aChoice: null };

export function otherSeat(seat: Seat): Seat {
  return seat === "a" ? "b" : "a";
}

/** 协议是否走完（颜色已定） */
export function isSwap2Resolved(st: Swap2State): boolean {
  if (st.bChoice === null) return false;
  return st.bChoice === "place2" ? st.aChoice !== null : true;
}

/** 定色后执黑的席位（协议未走完时按暂定返回 a） */
export function swap2BlackSeat(st: Swap2State): Seat {
  if (st.bChoice === "black") return "b";
  if (st.bChoice === "place2") return st.aChoice === "white" ? "b" : "a";
  return "a";
}

/** 定色时棋盘上的开局手数：直接定色 3 手，走了加摆两子 5 手 */
export function swap2OpeningLen(st: Swap2State): number {
  return st.bChoice === "place2" ? 5 : 3;
}

/** 当前待执行的开局动作；null = 协议已结束，进入正常对弈 */
export function swap2Pending(
  st: Swap2State,
  movesLen: number,
): { seat: Seat; act: "place" | "choose" } | null {
  if (st.bChoice === null) {
    if (movesLen < 3) return { seat: "a", act: "place" };
    if (movesLen === 3) return { seat: "b", act: "choose" };
    return null;
  }
  if (st.bChoice === "place2") {
    if (movesLen < 5) return { seat: "b", act: "place" };
    if (movesLen === 5 && st.aChoice === null) return { seat: "a", act: "choose" };
  }
  return null;
}

/** 由棋谱数量推导当前请求应使用的阶段名（与 API 的 swap2 字段一致） */
export function swap2StageOf(
  pending: { seat: Seat; act: "place" | "choose" },
  movesLen: number,
): "place3" | "place2" | "choose1" | "choose2" {
  if (pending.act === "choose") return movesLen === 3 ? "choose1" : "choose2";
  return movesLen < 3 ? "place3" : "place2";
}

/** 把一次抉择并入协议状态 */
export function applySwap2Choice(st: Swap2State, choice: Swap2Choice): Swap2State {
  if (st.bChoice === null) return { ...st, bChoice: choice };
  return { ...st, aChoice: choice === "place2" ? st.aChoice : choice };
}

/** 第 idx 手（0 起）由哪个席位所摆：开局子按协议归属，定色后按颜色归属 */
export function seatOfSwap2Move(st: Swap2State, idx: number): Seat {
  if (idx < 3) return "a";
  if (st.bChoice === "place2" && idx < 5) return "b";
  const black = swap2BlackSeat(st);
  return idx % 2 === 0 ? black : otherSeat(black);
}
