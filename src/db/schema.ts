import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** 模型配置表：协议、接入信息与推理/回传偏好 */
export const modelConfigs = sqliteTable("model_configs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  protocol: text("protocol").notNull(),
  modelId: text("model_id").notNull(),
  baseUrl: text("base_url").notNull().default(""),
  apiKey: text("api_key").notNull().default(""),
  /** 模型头像（data URL，客户端居中裁剪到 128px 后存储） */
  avatar: text("avatar").notNull().default(""),
  /** 多轮对话时是否把上一轮思维链发回服务端 */
  reasoningPassback: integer("reasoning_passback", { mode: "boolean" })
    .notNull()
    .default(false),
  /** passthrough = 原样回传（默认），custom = 自定义字段映射 */
  passbackMode: text("passback_mode").notNull().default("passthrough"),
  /** custom 策略下的回传字段名 */
  passbackField: text("passback_field").notNull().default(""),
  /** 调用时是否让模型思考 */
  thinkingEnabled: integer("thinking_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  /** 该模型支持的推理努力等级（json 字符串数组） */
  effortLevels: text("effort_levels", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  /** 输入上下文上限（tokens 估算值）；0 = 不限制，超限时自动压缩输入 */
  contextLimit: integer("context_limit").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type ModelConfigRow = typeof modelConfigs.$inferSelect;
export type ModelConfigInsert = typeof modelConfigs.$inferInsert;
