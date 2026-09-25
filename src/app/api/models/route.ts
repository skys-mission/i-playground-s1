import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { modelConfigs, type ModelConfigRow } from "@/db/schema";
import { sanitizeModelInput } from "@/lib/models";

/** 数据库行 → 客户端 JSON（时间戳转为毫秒数字，与页面类型一致） */
export function serialize(row: ModelConfigRow) {
  return {
    ...row,
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

  // 允许带入 id（localStorage 一次性导入时保持原 id），否则服务端生成
  const id =
    typeof (body as Record<string, unknown>)?.id === "string" &&
    (body as Record<string, unknown>).id
      ? String((body as Record<string, unknown>).id)
      : crypto.randomUUID();

  const inserted = await getDb()
    .insert(modelConfigs)
    .values({ id, ...parsed.value })
    .returning();
  return NextResponse.json(serialize(inserted[0]), { status: 201 });
}
