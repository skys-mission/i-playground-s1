import type { ProtocolId } from "./models";

/** 推理参数的「形态」状态机：各协议、各厂家控制思考的字段并不统一，
 *  我们只发协议标准字段，端点 4xx 拒绝时按错误提示逐级退让重试。
 *  纯函数、无副作用，可独立测试。
 *
 *  形态背景（2026-09 调研）：
 *  - OpenAI Chat：reasoning_effort；Responses：reasoning{effort, summary}
 *  - Anthropic 新老两代：老（3.7~4.6 系）只认 thinking{enabled, budget_tokens}，
 *    新（4.6+ / 5 系）只认 thinking{adaptive} + output_config.effort，
 *    无法从 modelId 预判世代，只能首发 legacy、被拒后按提示切换
 *  - 部分兼容端点（如 Kimi 的 Anthropic 层）schema 里没有 thinking 字段，需整体去掉 */

export interface ThinkingModelCfg {
  /** 协议 id；DB 行里存的是 string，匹配不上的一律按 anthropic-messages 处理（与调用侧一致） */
  protocol: string;
  thinkingEnabled: boolean;
  effortLevels: string[];
}

/** anthropic legacy 形态的固定思考预算：≥1024 且 < max_tokens（8192/32768），在所有接受 budget 的模型上合法 */
const ANTHROPIC_BUDGET = 2048;

export interface ThinkState {
  protocol: ProtocolId;
  /** 本局意图是关思考（对局开关关，或等级选了 none）——彻底关不掉的模型用来退到最低档 */
  intentOff: boolean;
  /** openai 两协议要拼进 body 的参数；null = 不发 */
  openai: Record<string, unknown> | null;
  /** anthropic：thinking 字段；null = 不发 */
  thinking: Record<string, unknown> | null;
  /** anthropic：output_config.effort 取值；null = 不发 */
  effort: string | null;
}

/** 由模型配置 + 本局选择得出思考参数初始形态；null = 该请求完全不带思考参数 */
export function initThinkState(
  cfg: ThinkingModelCfg,
  effort: string | undefined,
  enabled: boolean,
): ThinkState | null {
  if (!cfg.thinkingEnabled) {
    // 模型级开关关：anthropic 显式关（不少端点默认开思考，缺省会当成开）；
    // openai 系没有普适的关思考字段，只能不发
    return cfg.protocol === "anthropic-messages"
      ? { protocol: "anthropic-messages", intentOff: true, openai: null, thinking: { type: "disabled" }, effort: null }
      : null;
  }
  const level = effort && cfg.effortLevels.includes(effort) ? effort : null;
  switch (cfg.protocol) {
    case "openai-chat":
      return {
        protocol: "openai-chat",
        intentOff: !enabled,
        openai: enabled && level ? { reasoning_effort: level } : null,
        thinking: null,
        effort: null,
      };
    case "openai-responses":
      return {
        protocol: "openai-responses",
        intentOff: !enabled,
        // summary 需显式开启，否则默认收不到任何思维链增量
        openai: enabled && level ? { reasoning: { effort: level, summary: "auto" } } : null,
        thinking: null,
        effort: null,
      };
    default: {
      // anthropic-messages：等级经 output_config.effort 传递；
      // none=关思考；minimal 无官方对应（官方最低 low），退一档发送
      const off = !enabled || level === "none";
      const effortVal =
        level === "minimal" ? "low" : level && level !== "none" ? level : null;
      return {
        protocol: "anthropic-messages",
        intentOff: off,
        openai: null,
        thinking: off
          ? { type: "disabled" }
          : { type: "enabled", budget_tokens: ANTHROPIC_BUDGET },
        effort: off ? null : effortVal,
      };
    }
  }
}

/** 把状态展开成要拼进请求体的字段 */
export function buildThinkParams(state: ThinkState | null): Record<string, unknown> {
  if (!state) return {};
  if (state.protocol === "anthropic-messages") {
    const params: Record<string, unknown> = {};
    if (state.thinking) params.thinking = state.thinking;
    if (state.effort) params.output_config = { effort: state.effort };
    return params;
  }
  return state.openai ? { ...state.openai } : {};
}

/** anthropic 协议下本请求是否在思考（决定 max_tokens 档位）：
 *  显式 enabled / adaptive，或 thinking 被丢弃但 effort 仍在（端点默认开思考） */
export function anthropicThinkingOn(state: ThinkState | null): boolean {
  if (!state || state.protocol !== "anthropic-messages") return false;
  const t = state.thinking?.type;
  if (t === "enabled" || t === "adaptive") return true;
  return state.thinking === null && state.effort !== null;
}

export interface ThinkFallback {
  state: ThinkState;
  /** 给前端 notice 事件的说明 */
  note: string;
}

/** 端点不认识该字段（严格 schema 直接拒收） */
const FIELD_REJECTED = /extra input|not permitted|unrecogni|unexpected|unknown field/;
/** 字段认识但取值/形态不被接受 */
const VALUE_REJECTED = /unsupported|invalid|not supported|should be|must be|one of/;

/** 按端点 4xx 错误提示调整思考参数形态；无可退让时返回 null（错误原样上抛） */
export function applyThinkFallback(
  state: ThinkState,
  status: number,
  message: string,
): ThinkFallback | null {
  if (status !== 400 && status !== 422) return null;
  const m = message.toLowerCase();

  if (state.protocol === "anthropic-messages") {
    const t = state.thinking?.type;
    if (
      (t === "enabled" || t === "disabled") &&
      (/adaptive/.test(m) || (/thinking/.test(m) && VALUE_REJECTED.test(m)))
    ) {
      // 新一代模型只认 adaptive；意图是关思考但关不掉时，退到最低档
      const effort = state.intentOff ? (state.effort ?? "low") : state.effort;
      return {
        state: { ...state, thinking: { type: "adaptive" }, effort },
        note: "思考参数被端点拒绝，已切换为 adaptive 形态重试",
      };
    }
    if (state.thinking && /thinking/.test(m) && FIELD_REJECTED.test(m)) {
      return { state: { ...state, thinking: null }, note: "端点不认识 thinking 字段，已去掉后重试" };
    }
    if (
      state.effort &&
      /(output_config|effort)/.test(m) &&
      (FIELD_REJECTED.test(m) || VALUE_REJECTED.test(m))
    ) {
      return { state: { ...state, effort: null }, note: "端点不支持 output_config.effort，已去掉后重试" };
    }
    return null;
  }

  if (state.protocol === "openai-chat") {
    if (state.openai && /reasoning_effort/.test(m) && (FIELD_REJECTED.test(m) || VALUE_REJECTED.test(m))) {
      // 模型不支持推理参数（如 gpt-4o）：去掉后按普通模型调用
      return { state: { ...state, openai: null }, note: "端点不支持 reasoning_effort，已去掉后重试" };
    }
    return null;
  }

  // openai-responses
  const reasoning = state.openai?.reasoning as Record<string, unknown> | undefined;
  if (reasoning && reasoning.summary !== undefined && /summary/.test(m) && (FIELD_REJECTED.test(m) || VALUE_REJECTED.test(m))) {
    const next = { ...reasoning };
    delete next.summary;
    return { state: { ...state, openai: { reasoning: next } }, note: "端点不支持 reasoning.summary，已去掉后重试" };
  }
  if (state.openai && /reasoning/.test(m) && (FIELD_REJECTED.test(m) || VALUE_REJECTED.test(m))) {
    return { state: { ...state, openai: null }, note: "端点不支持 reasoning 参数，已去掉后重试" };
  }
  return null;
}
