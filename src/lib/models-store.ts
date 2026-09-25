import type { ModelConfig } from "./models";

// ---- 服务端模型列表的客户端缓存，包装成 useSyncExternalStore ----
// 游戏对局等页面也要读取模型列表，统一从这里订阅。

const EMPTY: ModelConfig[] = [];
let cache: ModelConfig[] | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

/** 强制从服务端拉取最新列表并通知订阅者 */
async function reload(): Promise<void> {
  inflight ??= (async () => {
    try {
      const res = await fetch("/api/models", { cache: "no-store" });
      if (res.ok) {
        cache = (await res.json()) as ModelConfig[];
        notify();
      }
    } catch {
      // 网络失败保留旧缓存，下次动作后重试
    } finally {
      inflight = null;
    }
  })();
  await inflight;
}

export function subscribeModels(listener: () => void): () => void {
  listeners.add(listener);
  // 首个订阅者挂载后触发首次加载
  if (cache === null && inflight === null) void reload();
  return () => {
    listeners.delete(listener);
  };
}

export function getModelsSnapshot(): ModelConfig[] {
  return cache ?? EMPTY;
}

export function getModelsServerSnapshot(): ModelConfig[] {
  return EMPTY;
}

/** 列表是否已从服务端加载完成（false = 首屏加载中） */
export function isModelsLoaded(): boolean {
  return cache !== null;
}

async function request(
  url: string,
  method: string,
  body?: unknown,
): Promise<{ ok: boolean; error?: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, error: "网络请求失败" };
  }
  if (res.ok) {
    await reload();
    return { ok: true };
  }
  let error = `请求失败（HTTP ${res.status}）`;
  try {
    const data = await res.json();
    if (data?.error) error = String(data.error);
  } catch {
    // 非 JSON 错误体，保留默认文案
  }
  return { ok: false, error };
}

export function createModel(input: unknown): Promise<{ ok: boolean; error?: string }> {
  return request("/api/models", "POST", input);
}

export function updateModel(
  id: string,
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  return request(`/api/models/${encodeURIComponent(id)}`, "PATCH", input);
}

export function deleteModel(id: string): Promise<{ ok: boolean; error?: string }> {
  return request(`/api/models/${encodeURIComponent(id)}`, "DELETE");
}
