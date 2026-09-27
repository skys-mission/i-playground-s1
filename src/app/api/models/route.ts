import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { modelConfigs, type ModelConfigRow } from "@/db/schema";
import { maskKey, sanitizeModelInput } from "@/lib/models";

/** 数据库行 → 客户端 JSON：不回传 apiKey，只给掩码（时间戳转为毫秒数字） */
export function serialize(row: ModelConfigRow) {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    modelId: row.modelId,
    baseUrl: row.baseUrl,
    apiKeyMask: maskKey(row.apiKey),
    avatar: row.avatar,
    reasoningPassback: row.reasoningPassback,
    passbackMode: row.passbackMode,
    passbackField: row.passbackField,
    thinkingEnabled: row.thinkingEnabled,
    effortLevels: row.effortLevels,
    contextLimit: row.contextLimit,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export async function GET() {
  const rows = await getDb()
    .select()
    .from(modelConfigs)
    .orderBy(desc(modelConfigs.createdAt));
  return NextResponse.json(rows.map(serialize));
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  const parsed = sanitizeModelInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const inserted = await getDb()
    .insert(modelConfigs)
    .values({ id: crypto.randomUUID(), ...parsed.value })
    .returning();
  return NextResponse.json(serialize(inserted[0]), { status: 201 });
}
