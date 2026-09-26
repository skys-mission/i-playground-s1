"use client";

import { useCallback, useMemo, useRef, useState } from "react";

/** 思维链展示的性能防线：
 *  - 增量先写进 ref，按 THINK_FLUSH_MS 节流刷新 state，避免逐 delta 重渲染
 *  - 按手数分轮积累；超过 THINK_KEEP_CHARS 时整轮裁掉最老的，
 *    但保底最近 THINK_MIN_ROUNDS 轮完整思考（max 档位推理的 2-3 轮） */
const THINK_KEEP_CHARS = 24000;
const THINK_MIN_ROUNDS = 2;
const THINK_FLUSH_MS = 120;

export type ThinkStream = ReturnType<typeof useThinkStream>;

export function useThinkStream() {
  const [text, setText] = useState("");
  const rounds = useRef<{ ply: number; label: string; text: string }[]>([]);
  const dropped = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildDisplay = useCallback(() => {
    const parts: string[] = [];
    if (dropped.current > 0) parts.push(`⋯ 前 ${dropped.current} 轮思考已省略 ⋯`);
    for (const r of rounds.current) {
      if (r.text) parts.push(`${r.label}\n${r.text}`);
    }
    return parts.join("\n\n");
  }, []);

  const flush = useCallback(() => {
    timer.current = null;
    setText(buildDisplay());
  }, [buildDisplay]);

  const schedule = useCallback(() => {
    if (timer.current === null) timer.current = setTimeout(flush, THINK_FLUSH_MS);
  }, [flush]);

  /** 新一手开始：同一手重试会替换掉未完成的上一轮 */
  const beginRound = useCallback(
    (ply: number, label?: string) => {
      const rs = rounds.current;
      if (rs.length > 0 && rs[rs.length - 1].ply === ply) rs.pop();
      rs.push({ ply, label: label ?? `── 第 ${ply} 手 ──`, text: "" });
      let keep = rs.reduce((sum, r) => sum + r.text.length, 0);
      while (rs.length - 1 > THINK_MIN_ROUNDS && keep > THINK_KEEP_CHARS) {
        keep -= rs[0].text.length;
        rs.shift();
        dropped.current++;
      }
      schedule();
    },
    [schedule],
  );

  const append = useCallback(
    (s: string) => {
      const rs = rounds.current;
      if (rs.length === 0) return;
      rs[rs.length - 1].text += s;
      schedule();
    },
    [schedule],
  );

  const appendNotice = useCallback(
    (t: string) => {
      const rs = rounds.current;
      if (rs.length === 0) return;
      rs[rs.length - 1].text += `\n\n—— ${t} ——\n`;
      schedule();
    },
    [schedule],
  );

  const reset = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    rounds.current = [];
    dropped.current = 0;
    setText("");
  }, []);

  return useMemo(
    () => ({ text, beginRound, append, appendNotice, reset }),
    [text, beginRound, append, appendNotice, reset],
  );
}
