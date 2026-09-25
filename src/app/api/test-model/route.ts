import { NextRequest, NextResponse } from "next/server";

interface TestPayload {
  protocol: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
}

const TIMEOUT_MS = 15000;

/** 服务端转发一次最小化的真实请求，验证模型配置能否调通（同时绕开浏览器 CORS） */
export async function POST(req: NextRequest) {
  let payload: TestPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "请求体解析失败" }, { status: 400 });
  }

  const { protocol, modelId, baseUrl, apiKey } = payload;
  if (!modelId || !baseUrl) {
    return NextResponse.json(
      { ok: false, message: "缺少模型 ID 或 Base URL" },
      { status: 400 },
    );
  }

  const base = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let url: string;
  let body: Record<string, unknown>;

  switch (protocol) {
    case "openai-chat":
      url = `${base}/chat/completions`;
      headers.Authorization = `Bearer ${apiKey}`;
      body = { model: modelId, messages: [{ role: "user", content: "Hi" }] };
      break;
    case "openai-responses":
      url = `${base}/responses`;
      headers.Authorization = `Bearer ${apiKey}`;
      body = { model: modelId, input: "Hi" };
      break;
    case "anthropic-messages":
      url = `${base}/v1/messages`;
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
      // Anthropic 的 max_tokens 是必填项
      body = {
        model: modelId,
        max_tokens: 1,
        messages: [{ role: "user", content: "Hi" }],
      };
      break;
    default:
      return NextResponse.json(
        { ok: false, message: `未知协议：${protocol}` },
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
