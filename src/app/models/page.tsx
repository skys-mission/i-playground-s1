"use client";

import { useState, useSyncExternalStore } from "react";
import { Avatar } from "@/components/Avatar";
import { SiteNav } from "@/components/SiteNav";
import { AVATAR_MAX_LENGTH, fileToAvatarDataUrl } from "@/lib/avatar";
import {
  type ModelConfig,
  type PassbackMode,
  type ProtocolId,
  PROTOCOLS,
  REASONING_LEVELS,
  clearLegacyModels,
  loadLegacyModels,
  maskKey,
  protocolMeta,
} from "@/lib/models";
import {
  createModel,
  deleteModel,
  getModelsServerSnapshot,
  getModelsSnapshot,
  isModelsLoaded,
  subscribeModels,
  updateModel,
} from "@/lib/models-store";

interface FormState {
  name: string;
  protocol: ProtocolId;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  avatar: string;
  thinkingEnabled: boolean;
  effortLevels: string[];
  reasoningPassback: boolean;
  passbackMode: PassbackMode;
  passbackField: string;
  /** 输入上下文上限（tokens），表单里用字符串便于输入；空/0 = 不限制 */
  contextLimit: string;
}

function emptyForm(): FormState {
  return {
    name: "",
    protocol: "openai-chat",
    modelId: "",
    baseUrl: PROTOCOLS[0].defaultBaseUrl,
    apiKey: "",
    avatar: "",
    thinkingEnabled: false,
    effortLevels: [],
    reasoningPassback: PROTOCOLS[0].reasoningDefault,
    passbackMode: "passthrough",
    passbackField: "",
    contextLimit: "230000",
  };
}

interface TestState {
  loading: boolean;
  ok?: boolean;
  message?: string;
  latencyMs?: number;
}

export default function ModelsPage() {
  const models = useSyncExternalStore(
    subscribeModels,
    getModelsSnapshot,
    getModelsServerSnapshot,
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [saving, setSaving] = useState(false);
  // 旧版数据存在浏览器 localStorage 里；服务端列表为空时提供一次性导入
  const [legacyModels, setLegacyModels] = useState<ModelConfig[]>(() => loadLegacyModels());
  const [importing, setImporting] = useState(false);

  const openCreate = () => {
    setForm(emptyForm());
    setEditingId(null);
    setError("");
    setShowKey(false);
    setModalOpen(true);
  };

  const openEdit = (model: ModelConfig) => {
    setForm({
      name: model.name,
      protocol: model.protocol,
      modelId: model.modelId,
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      avatar: model.avatar,
      thinkingEnabled: model.thinkingEnabled,
      effortLevels: model.effortLevels,
      reasoningPassback: model.reasoningPassback,
      passbackMode: model.passbackMode,
      passbackField: model.passbackField,
      contextLimit: model.contextLimit > 0 ? String(model.contextLimit) : "",
    });
    setEditingId(model.id);
    setError("");
    setShowKey(false);
    setModalOpen(true);
  };

  const changeProtocol = (protocol: ProtocolId) => {
    const meta = protocolMeta(protocol);
    setForm((prev) => {
      const oldDefault = protocolMeta(prev.protocol).defaultBaseUrl;
      // 用户没改过默认地址（或留空）时，跟随协议切换自动填充；思维链开关同样重置为协议默认
      const baseUrl =
        !prev.baseUrl || prev.baseUrl === oldDefault ? meta.defaultBaseUrl : prev.baseUrl;
      return {
        ...prev,
        protocol,
        baseUrl,
        reasoningPassback: meta.reasoningDefault,
      };
    });
  };

  const handleAvatarChange = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      if (dataUrl.length > AVATAR_MAX_LENGTH) {
        setError("头像图片过大，请换一张试试");
        return;
      }
      setForm((prev) => ({ ...prev, avatar: dataUrl }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "头像处理失败");
    }
  };

  const handleSave = async () => {
    const name = form.name.trim();
    const modelId = form.modelId.trim();
    if (!name) return setError("请填写模型名称");
    if (!modelId) return setError("请填写模型 ID");
    if (form.reasoningPassback && form.passbackMode === "custom" && !form.passbackField.trim())
      return setError("请填写自定义回传字段名");

    setSaving(true);
    setError("");
    const payload = {
      name,
      protocol: form.protocol,
      modelId,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      avatar: form.avatar,
      thinkingEnabled: form.thinkingEnabled,
      effortLevels: form.effortLevels,
      reasoningPassback: form.reasoningPassback,
      passbackMode: form.passbackMode,
      passbackField: form.passbackField.trim(),
      contextLimit: form.contextLimit.trim() === "" ? 0 : Math.max(0, Math.floor(Number(form.contextLimit) || 0)),
    };
    const result = editingId
      ? await updateModel(editingId, payload)
      : await createModel(payload);
    setSaving(false);
    if (!result.ok) return setError(result.error ?? "保存失败");
    setModalOpen(false);
  };

  const handleDelete = async (model: ModelConfig) => {
    if (!window.confirm(`确定删除「${model.name}」吗？`)) return;
    await deleteModel(model.id);
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      for (const m of legacyModels) {
        await createModel({
          name: m.name,
          protocol: m.protocol,
          modelId: m.modelId,
          baseUrl: m.baseUrl,
          apiKey: m.apiKey,
          avatar: m.avatar,
          thinkingEnabled: m.thinkingEnabled,
          effortLevels: m.effortLevels,
          reasoningPassback: m.reasoningPassback,
          passbackMode: m.passbackMode,
          passbackField: m.passbackField,
        });
      }
      clearLegacyModels();
      setLegacyModels([]);
    } finally {
      setImporting(false);
    }
  };

  const runTest = async (model: ModelConfig) => {
    setTests((prev) => ({ ...prev, [model.id]: { loading: true } }));
    try {
      const res = await fetch("/api/test-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocol: model.protocol,
          modelId: model.modelId,
          baseUrl: model.baseUrl,
          apiKey: model.apiKey,
        }),
      });
      const data: { ok: boolean; message: string; latencyMs: number } = await res.json();
      setTests((prev) => ({
        ...prev,
        [model.id]: {
          loading: false,
          ok: data.ok,
          message: data.message,
          latencyMs: data.latencyMs,
        },
      }));
    } catch {
      setTests((prev) => ({
        ...prev,
        [model.id]: { loading: false, ok: false, message: "请求发送失败" },
      }));
    }
  };

  return (
    <div className="min-h-screen">
      <SiteNav />

      <main className="mx-auto max-w-5xl px-4 pb-20">
        <div className="flex flex-wrap items-end justify-between gap-4 py-10">
          <div>
            <h1 className="text-3xl font-bold">模型配置</h1>
            <p className="mt-2 text-sm text-neutral-400">
              管理参赛选手：接入各家大模型，配置接口地址与密钥。数据保存在服务端本地 SQLite 数据库。
            </p>
          </div>
          <button
            onClick={openCreate}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-neutral-950 shadow-lg shadow-amber-500/20 transition-colors hover:bg-amber-400"
          >
            ＋ 新增模型
          </button>
        </div>

        {!isModelsLoaded() ? (
          <div className="rounded-2xl border border-white/10 py-20 text-center text-sm text-neutral-500">
            加载中…
          </div>
        ) : models.length === 0 && legacyModels.length > 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-amber-400/30 bg-amber-400/[0.03] py-16 text-center">
            <div className="text-4xl" aria-hidden>
              📦
            </div>
            <p className="mt-4 font-medium text-neutral-200">
              检测到浏览器里保存的 {legacyModels.length} 个模型配置
            </p>
            <p className="mt-1 text-sm text-neutral-500">
              存储已切换到服务端数据库，可以把旧配置一次性导入
            </p>
            <button
              onClick={handleImport}
              disabled={importing}
              className="mt-6 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-neutral-950 transition-colors hover:bg-amber-400 disabled:cursor-wait disabled:opacity-60"
            >
              {importing ? "导入中…" : "导入到数据库"}
            </button>
          </div>
        ) : models.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/15 py-20 text-center">
            <div className="text-5xl" aria-hidden>
              🏟️
            </div>
            <p className="mt-4 font-medium text-neutral-300">还没有参赛选手</p>
            <p className="mt-1 text-sm text-neutral-500">
              添加一个模型，让它加入竞技场吧
            </p>
            <button
              onClick={openCreate}
              className="mt-6 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium transition-colors hover:bg-white/20"
            >
              ＋ 新增第一个模型
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-white/5 rounded-2xl border border-white/10">
            {models.map((model) => {
              const meta = protocolMeta(model.protocol);
              return (
                <li
                  key={model.id}
                  className="p-4 transition-colors hover:bg-white/[0.02]"
                >
                  <div className="flex items-start gap-3">
                    <Avatar
                      name={model.name}
                      src={model.avatar || undefined}
                      className="size-10 shrink-0 text-base"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <h2 className="text-sm font-semibold">{model.name}</h2>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ring-1 ${meta.badgeClass}`}
                        >
                          {meta.label}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
                            model.thinkingEnabled
                              ? "bg-amber-400/10 text-amber-300 ring-amber-400/25"
                              : "bg-white/5 text-neutral-500 ring-white/10"
                          }`}
                          title={
                            model.thinkingEnabled
                              ? protocolMeta(model.protocol).thinkingHint +
                                (model.effortLevels.length
                                  ? `（已选：${model.effortLevels.join(" / ")}）`
                                  : "")
                              : "调用时不开启思考"
                          }
                        >
                          ⚡ 推理
                          {model.thinkingEnabled
                            ? model.effortLevels.length
                              ? ` · ${model.effortLevels.length} 档`
                              : ""
                            : "关"}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
                            model.reasoningPassback
                              ? "bg-amber-400/10 text-amber-300 ring-amber-400/25"
                              : "bg-white/5 text-neutral-500 ring-white/10"
                          }`}
                          title={
                            model.reasoningPassback
                              ? "多轮对话时把上一轮思维链发回服务端"
                              : "多轮对话时不把思维链发回服务端"
                          }
                        >
                          🧠 回传
                          {model.reasoningPassback
                            ? model.passbackMode === "custom"
                              ? ` · ${model.passbackField || "自定义字段"}`
                              : " · 原样"
                            : "关"}
                        </span>
                        {model.contextLimit > 0 && (
                          <span
                            className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-neutral-400 ring-1 ring-white/10"
                            title="输入超过此上限（tokens 估算）时自动压缩"
                          >
                            📏 ≤{model.contextLimit >= 1000 ? `${Math.round(model.contextLimit / 1000)}k` : model.contextLimit}
                          </span>
                        )}
                        <code className="rounded bg-neutral-800/80 px-1.5 py-0.5 font-mono text-xs text-neutral-300">
                          {model.modelId}
                        </code>

                        <div className="ml-auto flex gap-2">
                          <button
                            onClick={() => runTest(model)}
                            disabled={tests[model.id]?.loading}
                            className="rounded-lg bg-white/5 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
                          >
                            {tests[model.id]?.loading ? "测试中…" : "测试"}
                          </button>
                          <button
                            onClick={() => openEdit(model)}
                            className="rounded-lg bg-white/5 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/10"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => handleDelete(model)}
                            className="rounded-lg bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20"
                          >
                            删除
                          </button>
                        </div>
                      </div>

                      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-neutral-500">
                        <span className="max-w-full truncate" title={model.baseUrl}>
                          {model.baseUrl || "—"}
                        </span>
                        <span>{maskKey(model.apiKey)}</span>
                      </p>

                      {tests[model.id] && !tests[model.id].loading && (
                        <p
                          className={`mt-2 truncate text-xs ${
                            tests[model.id].ok ? "text-emerald-400" : "text-red-400"
                          }`}
                          title={tests[model.id].message}
                        >
                          {tests[model.id].ok
                            ? `✓ 连通 · ${tests[model.id].latencyMs}ms`
                            : `✗ ${tests[model.id].message}`}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {/* 新增 / 编辑弹窗：限高 + 内容区滚动，任何屏都出不了首屏 */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="flex max-h-[calc(100dvh-6rem)] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 px-6 pt-5">
              <h2 className="text-xl font-bold">
                {editingId ? "编辑模型" : "新增模型"}
              </h2>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-3">
              {/* 头像 + 名称一行；头像上传后裁剪为 128px data URL 存库 */}
              <div className="flex items-end gap-4">
                <Avatar
                  name={form.name}
                  src={form.avatar || undefined}
                  className="size-14 shrink-0 text-xl"
                />
                <div className="flex shrink-0 flex-col gap-1.5 pb-1.5">
                  <div className="flex gap-2">
                    <label
                      className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        form.avatar
                          ? "bg-white/5 hover:bg-white/10"
                          : "bg-amber-500 font-semibold text-neutral-950 hover:bg-amber-400"
                      }`}
                    >
                      {form.avatar ? "更换头像" : "上传头像"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          void handleAvatarChange(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {form.avatar && (
                      <button
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, avatar: "" }))}
                        className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:bg-white/10"
                      >
                        移除
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-neutral-500">不上传则用名字首字</p>
                </div>
                <div className="min-w-0 flex-1">
                  <label className="mb-1.5 block text-sm text-neutral-300">
                    名称 <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="例如：GLM 主力 / GPT 参谋"
                    className="w-full rounded-lg border border-white/10 bg-neutral-800/60 px-3 py-2 text-sm outline-none placeholder:text-neutral-600 focus:border-amber-400/60"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm text-neutral-300">协议</label>
                  <select
                    value={form.protocol}
                    onChange={(e) => changeProtocol(e.target.value as ProtocolId)}
                    className="w-full rounded-lg border border-white/10 bg-neutral-800/60 px-3 py-2 text-sm outline-none focus:border-amber-400/60"
                  >
                    {PROTOCOLS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm text-neutral-300">
                    模型 ID <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={form.modelId}
                    onChange={(e) => setForm({ ...form, modelId: e.target.value })}
                    placeholder={protocolMeta(form.protocol).suggestedModel || "model-id"}
                    className="w-full rounded-lg border border-white/10 bg-neutral-800/60 px-3 py-2 font-mono text-sm outline-none placeholder:text-neutral-600 focus:border-amber-400/60"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm text-neutral-300">
                    API Base URL
                  </label>
                  <input
                    value={form.baseUrl}
                    onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                    placeholder="https://api.example.com/v1"
                    className="w-full rounded-lg border border-white/10 bg-neutral-800/60 px-3 py-2 font-mono text-sm outline-none placeholder:text-neutral-600 focus:border-amber-400/60"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm text-neutral-300">API Key</label>
                  <div className="flex gap-2">
                    <input
                      type={showKey ? "text" : "password"}
                      value={form.apiKey}
                      onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                      placeholder="sk-..."
                      autoComplete="off"
                      className="min-w-0 flex-1 rounded-lg border border-white/10 bg-neutral-800/60 px-3 py-2 font-mono text-sm outline-none placeholder:text-neutral-600 focus:border-amber-400/60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="shrink-0 rounded-lg bg-white/5 px-3 text-sm transition-colors hover:bg-white/10"
                      aria-label={showKey ? "隐藏密钥" : "显示密钥"}
                    >
                      {showKey ? "🙈" : "👁"}
                    </button>
                  </div>
                </div>
              </div>

              {/* 推理控制：开关 = 要不要思考；等级 = 该模型支持的推理努力档位（平铺勾选） */}
              <div className="rounded-xl border border-white/10 bg-neutral-800/40 p-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-2 text-sm font-medium text-neutral-200">
                    <span aria-hidden>⚡</span> 推理控制
                    <span className="text-xs font-normal text-neutral-500">调用时是否思考</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.thinkingEnabled}
                    aria-label="推理开关"
                    onClick={() =>
                      setForm((prev) => ({ ...prev, thinkingEnabled: !prev.thinkingEnabled }))
                    }
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      form.thinkingEnabled ? "bg-amber-500" : "bg-neutral-600"
                    }`}
                  >
                    <span
                      className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                        form.thinkingEnabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">
                  {protocolMeta(form.protocol).thinkingHint}
                </p>

                <div className="mt-2.5 border-t border-white/5 pt-2.5">
                  <p className="text-xs text-neutral-400">
                    支持的推理努力等级（按该模型实际支持的勾选，none=不思考）：
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {REASONING_LEVELS.map((level) => {
                      const active = form.effortLevels.includes(level);
                      return (
                        <button
                          key={level}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              effortLevels: active
                                ? prev.effortLevels.filter((l) => l !== level)
                                : [...prev.effortLevels, level],
                            }))
                          }
                          className={`rounded-full px-3 py-1 font-mono text-xs font-medium ring-1 transition-colors ${
                            active
                              ? "bg-amber-500 text-neutral-950 ring-amber-500"
                              : "bg-white/5 text-neutral-400 ring-white/10 hover:bg-white/10"
                          }`}
                        >
                          {level}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 上下文上限 + 回传：并排两列，缩短弹窗 */}
              <div className="grid grid-cols-2 items-start gap-3">
              {/* 输入上下文上限：超限时自动压缩输入（省略较早历史，保留最新局面） */}
              <div className="rounded-xl border border-white/10 bg-neutral-800/40 p-3">
                <span className="flex items-center gap-2 text-sm font-medium text-neutral-200">
                  <span aria-hidden>📏</span> 输入上下文上限
                  <span className="text-[11px] font-normal text-neutral-500">超限自动压缩</span>
                </span>
                <input
                  type="number"
                  min={0}
                  value={form.contextLimit}
                  onChange={(e) => setForm((prev) => ({ ...prev, contextLimit: e.target.value }))}
                  placeholder="0 = 不限制"
                  className="mt-2 w-full rounded-lg border border-white/10 bg-neutral-800/60 px-3 py-2 font-mono text-sm outline-none placeholder:text-neutral-600 focus:border-amber-400/60"
                />
                <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">
                  tokens 估算，超限时自动省略较早历史
                </p>
              </div>

              {/* 思维链回传开关：控制多轮对话时是否把思维链发回服务端（接收展示不受影响） */}
              <div className="rounded-xl border border-white/10 bg-neutral-800/40 p-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-2 text-sm font-medium text-neutral-200">
                    <span aria-hidden>🧠</span> 思维链回传
                    <span className="text-[11px] font-normal text-neutral-500">多轮时发回服务端</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.reasoningPassback}
                    aria-label="思维链回传开关"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        reasoningPassback: !prev.reasoningPassback,
                      }))
                    }
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      form.reasoningPassback ? "bg-amber-500" : "bg-neutral-600"
                    }`}
                  >
                    <span
                      className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                        form.reasoningPassback ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">
                  只控制多轮对话时是否把上一轮思维链发回服务端
                </p>

                {form.reasoningPassback && (
                  <div className="mt-2 space-y-1.5 border-t border-white/5 pt-2">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="passback-mode"
                        checked={form.passbackMode === "passthrough"}
                        onChange={() => setForm({ ...form, passbackMode: "passthrough" })}
                        className="size-4 accent-amber-500"
                      />
                      <span className="text-sm text-neutral-200">原样回传（默认）</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="passback-mode"
                        checked={form.passbackMode === "custom"}
                        onChange={() => setForm({ ...form, passbackMode: "custom" })}
                        className="size-4 accent-amber-500"
                      />
                      <span className="text-sm text-neutral-200">自定义字段映射</span>
                    </label>
                    {form.passbackMode === "custom" && (
                      <input
                        value={form.passbackField}
                        onChange={(e) =>
                          setForm({ ...form, passbackField: e.target.value })
                        }
                        placeholder="字段名，例如：reasoning_content"
                        className="w-full rounded-lg border border-white/10 bg-neutral-800/60 px-3 py-2 font-mono text-sm outline-none placeholder:text-neutral-600 focus:border-amber-400/60"
                      />
                    )}
                  </div>
                )}
              </div>
              </div>
            </div>

            {error && (
              <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}
            </div>

            <div className="shrink-0 border-t border-white/5 px-6 py-4">
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm text-neutral-400 transition-colors hover:bg-white/5 hover:text-neutral-200"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-neutral-950 shadow-lg shadow-amber-500/20 transition-colors hover:bg-amber-400 disabled:cursor-wait disabled:opacity-60"
                >
                  {saving ? "保存中…" : "保存"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
