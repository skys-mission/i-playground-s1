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
    thinkingHint: "调用时是否思考；等级即 reasoning_effort 取值，none=不思考。",
  },
  {
    id: "openai-responses",
    label: "OpenAI · Responses",
    defaultBaseUrl: "https://api.openai.com/v1",
    suggestedModel: "gpt-5",
    badgeClass: "bg-teal-500/15 text-teal-300 ring-teal-500/30",
    reasoningDefault: true,
    thinkingHint: "调用时是否思考；等级即 reasoning.effort 取值，none=不思考。",
  },
  {
    id: "anthropic-messages",
    label: "Anthropic · Messages",
    defaultBaseUrl: "https://api.anthropic.com",
    suggestedModel: "claude-sonnet-4-5",
    badgeClass: "bg-orange-500/15 text-orange-300 ring-orange-500/30",
    reasoningDefault: true,
    thinkingHint:
      "等级经 output_config.effort 传递（minimal 按 low、none=关思考）；新旧模型的思考参数形态自动兼容。",
  },
];

export function protocolMeta(id: ProtocolId): ProtocolMeta {
  return PROTOCOLS.find((p) => p.id === id) ?? PROTOCOLS[0];
}

/** 推理努力等级全集（各家取值之并，用户按模型实际支持的勾选）：
 *  none=不思考（gpt-5.1+ / DeepSeek / 火山 Ark 等；Anthropic 协议发送时映射为关思考）。
 *  值与请求字段一致，小写原样，不额外转换 */
export const REASONING_LEVELS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

/** 上下文上限入参清洗：非正数/非法值一律归 0（= 不限制），封顶千万 */
function parseContextLimit(v: unknown): number {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && v.trim() !== ""
        ? Number(v)
        : 0;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), 10_000_000);
}

/** 思维链回传策略：passthrough = 原样回传（默认），custom = 自定义字段映射 */
export type PassbackMode = "passthrough" | "custom";

export interface ModelConfig {
  id: string;
  name: string;
  protocol: ProtocolId;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  /** 模型头像（data URL，空串 = 无头像） */
  avatar: string;
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
  /** 输入上下文上限（tokens 估算值）；0 = 不限制，超限时由调用方自动压缩输入 */
  contextLimit: number;
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
    avatar: typeof raw.avatar === "string" && raw.avatar.startsWith("data:image/") ? raw.avatar : "",
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
    contextLimit: parseContextLimit(raw.contextLimit),
    createdAt: Number(raw.createdAt ?? Date.now()),
    updatedAt: Number(raw.updatedAt ?? Date.now()),
  };
}

/** 读取旧版 localStorage 数据：仅用于一次性迁移导入服务端数据库 */
export function loadLegacyModels(): ModelConfig[] {
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

/** 导入完成后清掉旧存储，避免重复提示 */
export function clearLegacyModels(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/** 新增/编辑时的入参（不含 id 与时间戳，由服务端生成） */
export interface ModelConfigInput {
  name: string;
  protocol: ProtocolId;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  avatar: string;
  reasoningPassback: boolean;
  passbackMode: PassbackMode;
  passbackField: string;
  thinkingEnabled: boolean;
  effortLevels: string[];
  contextLimit: number;
}

/** 服务端入库前的统一校验与清洗，客户端与 API 路由共用 */
export function sanitizeModelInput(
  raw: unknown,
): { ok: true; value: ModelConfigInput } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "请求体格式错误" };
  }
  const r = raw as Record<string, unknown>;

  const name = String(r.name ?? "").trim();
  if (!name) return { ok: false, error: "请填写模型名称" };
  const modelId = String(r.modelId ?? "").trim();
  if (!modelId) return { ok: false, error: "请填写模型 ID" };
  if (!PROTOCOLS.some((p) => p.id === r.protocol)) {
    return { ok: false, error: "协议不合法" };
  }
  const passbackMode: PassbackMode = r.passbackMode === "custom" ? "custom" : "passthrough";
  const passbackField = String(r.passbackField ?? "").trim();
  if (passbackMode === "custom" && !passbackField) {
    return { ok: false, error: "请填写自定义回传字段名" };
  }

  // 头像：空串 = 无头像；有值时必须是 data URL（客户端已裁剪到 128px）
  const avatarRaw = r.avatar === undefined ? "" : r.avatar;
  if (typeof avatarRaw !== "string" || avatarRaw.length > 700_000) {
    return { ok: false, error: "头像数据过大或格式不对" };
  }
  if (avatarRaw && !avatarRaw.startsWith("data:image/")) {
    return { ok: false, error: "头像必须是图片文件" };
  }

  return {
    ok: true,
    value: {
      name,
      protocol: r.protocol as ProtocolId,
      modelId,
      baseUrl: String(r.baseUrl ?? "").trim(),
      apiKey: String(r.apiKey ?? "").trim(),
      avatar: avatarRaw,
      reasoningPassback: Boolean(r.reasoningPassback),
      passbackMode,
      passbackField,
      thinkingEnabled: Boolean(r.thinkingEnabled),
      effortLevels: Array.isArray(r.effortLevels)
        ? r.effortLevels.filter(
            (l): l is string =>
              typeof l === "string" && (REASONING_LEVELS as readonly string[]).includes(l),
          )
        : [],
      contextLimit: parseContextLimit(r.contextLimit),
    },
  };
}

/** API Key 打码展示，只保留前 4 位与后 4 位 */
export function maskKey(key: string): string {
  if (!key) return "未设置";
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}${"•".repeat(6)}${key.slice(-4)}`;
}
