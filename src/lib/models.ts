export type ProtocolId = "openai-chat" | "openai-responses" | "anthropic-messages";

export interface ProtocolMeta {
  id: ProtocolId;
  label: string;
  defaultBaseUrl: string;
  suggestedModel: string;
  /** Tailwind 类名，用于协议徽章配色 */
  badgeClass: string;
  /** 思维链回传开关的默认值：官方标准协议默认开，chat 无标准默认关（回传有 400 风险） */
  reasoningDefault: boolean;
  /** 推理开关说明文案（一句话，按协议给出对应请求字段名） */
  thinkingHint: string;
}

export const PROTOCOLS: ProtocolMeta[] = [
  {
    id: "openai-chat",
    label: "OpenAI · Chat Completions",
    defaultBaseUrl: "https://api.openai.com/v1",
    suggestedModel: "gpt-4o",
    badgeClass: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    reasoningDefault: false,
    thinkingHint: "调用时是否思考，等级即请求传递的推理努力取值。",
  },
  {
    id: "openai-responses",
    label: "OpenAI · Responses",
    defaultBaseUrl: "https://api.openai.com/v1",
    suggestedModel: "gpt-5",
    badgeClass: "bg-teal-500/15 text-teal-300 ring-teal-500/30",
    reasoningDefault: true,
    thinkingHint: "调用时是否思考，等级对应 reasoning.effort 取值。",
  },
  {
    id: "anthropic-messages",
    label: "Anthropic · Messages",
    defaultBaseUrl: "https://api.anthropic.com",
    suggestedModel: "claude-sonnet-4-5",
    badgeClass: "bg-orange-500/15 text-orange-300 ring-orange-500/30",
    reasoningDefault: true,
    thinkingHint: "调用时是否思考，等级对应 output_config.effort 取值。",
  },
];

export function protocolMeta(id: ProtocolId): ProtocolMeta {
  return PROTOCOLS.find((p) => p.id === id) ?? PROTOCOLS[0];
}

/** 推理努力等级全集：与请求中传递的字段值一致，小写原样，不额外转换 */
export const REASONING_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

/** 思维链回传策略：passthrough = 原样回传（默认），custom = 自定义字段映射 */
export type PassbackMode = "passthrough" | "custom";

export interface ModelConfig {
  id: string;
  name: string;
  protocol: ProtocolId;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  /** 思维链回传开关：多轮对话时是否把上一轮思维链随历史消息发回服务端。
   *  接收侧（流式解析 reasoning_content / reasoning 并展示）无条件支持，不受此开关控制。 */
  reasoningPassback: boolean;
  /** 回传策略，默认原样回传 */
  passbackMode: PassbackMode;
  /** custom 策略下的回传字段名（如 reasoning_content） */
  passbackField: string;
  /** 推理开关：调用时是否让模型思考（请求侧参数，各家字段不同）。
   *  命名避开历史字段 reasoningEnabled（曾用于接收语义，已废弃）。 */
  thinkingEnabled: boolean;
  /** 该模型支持的推理努力等级（用户勾选；空 = 仅开/关思考、无等级概念，如 GLM） */
  effortLevels: string[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "ai-arena:models";

/** 兼容旧版按供应商存储的数据：provider → protocol 迁移 */
function normalize(raw: Record<string, unknown>): ModelConfig {
  const protocol =
    typeof raw.protocol === "string" &&
    PROTOCOLS.some((p) => p.id === raw.protocol)
      ? (raw.protocol as ProtocolId)
      : // 旧数据只有 provider：Anthropic 归 Messages，其余按 OpenAI 系处理
        raw.provider === "anthropic"
        ? "anthropic-messages"
        : "openai-chat";
  return {
    id: String(raw.id ?? crypto.randomUUID()),
    name: String(raw.name ?? ""),
    protocol,
    modelId: String(raw.modelId ?? ""),
    baseUrl: String(raw.baseUrl ?? ""),
    apiKey: String(raw.apiKey ?? ""),
    // 旧数据可能是接收语义的 reasoningEnabled：沿用其值，否则按协议默认补齐
    reasoningPassback:
      typeof raw.reasoningPassback === "boolean"
        ? raw.reasoningPassback
        : typeof raw.reasoningEnabled === "boolean"
          ? raw.reasoningEnabled
          : protocolMeta(protocol).reasoningDefault,
    passbackMode: raw.passbackMode === "custom" ? "custom" : "passthrough",
    passbackField: typeof raw.passbackField === "string" ? raw.passbackField.trim() : "",
    thinkingEnabled: Boolean(raw.thinkingEnabled),
    effortLevels: Array.isArray(raw.effortLevels)
      ? raw.effortLevels.filter((l): l is string =>
          (REASONING_LEVELS as readonly string[]).includes(l),
        )
      : [],
    createdAt: Number(raw.createdAt ?? Date.now()),
    updatedAt: Number(raw.updatedAt ?? Date.now()),
  };
}

export function loadModels(): ModelConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalize);
  } catch {
    return [];
  }
}

// ---- 把 localStorage 包装成 React 外部存储（useSyncExternalStore） ----

const EMPTY: ModelConfig[] = [];
let cache: ModelConfig[] | null = null;
const listeners = new Set<() => void>();

export function subscribeModels(listener: () => void): () => void {
  listeners.add(listener);
  // 跨标签页同步：其它页面写入时失效缓存并通知
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STORAGE_KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getModelsSnapshot(): ModelConfig[] {
  cache ??= loadModels();
  return cache;
}

export function getModelsServerSnapshot(): ModelConfig[] {
  return EMPTY;
}

export function saveModels(models: ModelConfig[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(models));
  cache = models;
  for (const fn of listeners) fn();
}

/** API Key 打码展示，只保留前 4 位与后 4 位 */
export function maskKey(key: string): string {
  if (!key) return "未设置";
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}${"•".repeat(6)}${key.slice(-4)}`;
}
