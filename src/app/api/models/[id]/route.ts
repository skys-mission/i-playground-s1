import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { modelConfigs } from "@/db/schema";
import { sanitizeModelInput } from "@/lib/models";
import { serialize } from "../route";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;

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

  const updated = await getDb()
    .update(modelConfigs)
    .set({ ...parsed.value, updatedAt: new Date() })
    .where(eq(modelConfigs.id, id))
    .returning();

  if (updated.length === 0) {
    return NextResponse.json({ error: "模型不存在" }, { status: 404 });
  }
  return NextResponse.json(serialize(updated[0]));
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const deleted = await getDb()
    .delete(modelConfigs)
    .where(eq(modelConfigs.id, id))
    .returning({ id: modelConfigs.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: "模型不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
