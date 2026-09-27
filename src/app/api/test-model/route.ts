import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { modelConfigs } from "@/db/schema";

const TIMEOUT_MS = 15000;

/** 按模型配置 id 转发一次最小化的真实请求，验证配置能否调通。
 *  密钥只存在服务端，请求体里不再出现 */
export async function POST(req: NextRequest) {
  let id: unknown;
  try {
    id = (await req.json())?.id;
  } catch {
    return NextResponse.json({ ok: false, message: "请求体解析失败" }, { status: 400 });
  }
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ ok: false, message: "缺少模型配置 ID" }, { status: 400 });
  }

  const rows = await getDb()
    .select()
    .from(modelConfigs)
    .where(eq(modelConfigs.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ ok: false, message: "找不到该模型配置" }, { status: 404 });
  }

  const base = row.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let url: string;
  let body: Record<string, unknown>;

  switch (row.protocol) {
    case "openai-chat":
      url = `${base}/chat/completions`;
      headers.Authorization = `Bearer ${row.apiKey}`;
      body = { model: row.modelId, messages: [{ role: "user", content: "Hi" }] };
      break;
    case "openai-responses":
      url = `${base}/responses`;
      headers.Authorization = `Bearer ${row.apiKey}`;
      body = { model: row.modelId, input: "Hi" };
      break;
    case "anthropic-messages":
      url = `${base}/v1/messages`;
      headers["x-api-key"] = row.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      // Anthropic 的 max_tokens 是必填项
      body = {
        model: row.modelId,
        max_tokens: 1,
        messages: [{ role: "user", content: "Hi" }],
      };
      break;
    default:
      return NextResponse.json(
        { ok: false, message: `未知协议：${row.protocol}` },
        { status: 400 },
      );
  }

  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    const text = await res.text();
    let message = res.statusText || `HTTP ${res.status}`;
    if (text) {
      try {
        const data = JSON.parse(text);
        // OpenAI / Anthropic 的错误结构都是 { error: { message } }
        message = data?.error?.message ?? message;
      } catch {
        // 非 JSON 响应，保留 statusText
      }
    }
    return NextResponse.json({ ok: res.ok, status: res.status, latencyMs, message });
  } catch (e) {
    const latencyMs = Date.now() - started;
    const aborted = e instanceof DOMException || (e instanceof Error && e.name === "TimeoutError");
    const message = aborted
      ? `请求超时或网络错误（上限 ${TIMEOUT_MS / 1000}s）`
      : e instanceof Error
        ? e.message
        : String(e);
    return NextResponse.json({ ok: false, status: 0, latencyMs, message });
  }
}
