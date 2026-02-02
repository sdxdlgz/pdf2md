"use client";

import { upload } from "@vercel/blob/client";
import { useCallback, useMemo, useRef, useState } from "react";

type MineruTaskState =
  | "done"
  | "waiting-file"
  | "pending"
  | "running"
  | "failed"
  | "converting";

type MineruResult = {
  file_name: string;
  state: MineruTaskState;
  err_msg?: string;
  full_zip_url?: string;
  data_id?: string;
  extract_progress?: {
    extracted_pages: number;
    total_pages: number;
    start_time: string;
  };
};

type UploadItem = {
  dataId: string;
  originalName: string;
  file: File;
  blobUrl?: string;
  blobDownloadUrl?: string;
  uploadProgress: number;
  mineru?: MineruResult;
};

type ModelVersion = "pipeline" | "vlm";

function humanBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export default function MineruUploader() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [modelVersion, setModelVersion] = useState<ModelVersion>("vlm");
  const [includeDocx, setIncludeDocx] = useState(true);
  const [isOcr, setIsOcr] = useState(false);
  const [enableFormula, setEnableFormula] = useState(true);
  const [enableTable, setEnableTable] = useState(true);
  const [language, setLanguage] = useState("ch");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);

  const pollTimer = useRef<number | null>(null);

  const resetPoll = useCallback(() => {
    if (pollTimer.current) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const onChooseFiles = useCallback((files: FileList | null) => {
    resetPoll();
    setBatchId(null);
    setError(null);

    if (!files || files.length === 0) {
      setItems([]);
      return;
    }

    const jobId = crypto.randomUUID();
    const next: UploadItem[] = Array.from(files).map((file, index) => ({
      dataId: `${jobId}-${index}`,
      originalName: file.name,
      file,
      uploadProgress: 0,
    }));

    setItems(next);
  }, [resetPoll]);

  const allDone = useMemo(() => {
    if (items.length === 0) return false;
    return items.every((it) => it.mineru?.state === "done" || it.mineru?.state === "failed");
  }, [items]);

  const canStart = useMemo(() => items.length > 0 && !busy, [items.length, busy]);

  const start = useCallback(async () => {
    resetPoll();
    setError(null);
    setBusy(true);
    setBatchId(null);

    try {
      // 1) Upload files to Vercel Blob
      const uploaded: UploadItem[] = [];

      for (const item of items) {
        setItems((prev) =>
          prev.map((p) =>
            p.dataId === item.dataId ? { ...p, uploadProgress: 0 } : p,
          ),
        );

        const pathname = `uploads/${item.dataId}/${item.originalName}`;
        const blob = await upload(pathname, item.file, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          multipart: true,
          onUploadProgress: ({ percentage }) => {
            setItems((prev) =>
              prev.map((p) =>
                p.dataId === item.dataId
                  ? { ...p, uploadProgress: percentage }
                  : p,
              ),
            );
          },
        });

        uploaded.push({
          ...item,
          blobUrl: blob.url,
          blobDownloadUrl: blob.downloadUrl,
          uploadProgress: 100,
        });
        setItems((prev) =>
          prev.map((p) =>
            p.dataId === item.dataId
              ? {
                  ...p,
                  blobUrl: blob.url,
                  blobDownloadUrl: blob.downloadUrl,
                  uploadProgress: 100,
                }
              : p,
          ),
        );
      }

      // 2) Ask Mineru for upload URLs, then the server uploads stored files to Mineru
      const res = await fetch("/api/mineru/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: uploaded.map((u) => ({
            name: u.originalName,
            blobUrl: u.blobUrl,
            blobDownloadUrl: u.blobDownloadUrl,
            data_id: u.dataId,
          })),
          model_version: modelVersion,
          extra_formats: includeDocx ? ["docx"] : undefined,
          is_ocr: isOcr,
          enable_formula: enableFormula,
          enable_table: enableTable,
          language,
        }),
      });

      const json = (await res.json()) as { batchId?: string; error?: string; detail?: string };
      if (!res.ok || !json.batchId) {
        throw new Error(json.detail || json.error || "Failed to create batch task.");
      }

      setBatchId(json.batchId);

      // 3) Poll batch status
      const poll = async (id: string) => {
        const r = await fetch(`/api/mineru/batch/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        const data = (await r.json()) as { results?: MineruResult[]; error?: string; detail?: string };
        if (!r.ok || !Array.isArray(data.results)) {
          throw new Error(data.detail || data.error || "Failed to fetch batch results.");
        }

        setItems((prev) => {
          const byId = new Map<string, MineruResult>();
          for (const result of data.results ?? []) {
            if (result.data_id) byId.set(result.data_id, result);
          }

          return prev.map((p) => ({
            ...p,
            mineru: byId.get(p.dataId) ?? p.mineru,
          }));
        });

        const done = (data.results ?? []).every(
          (x) => x.state === "done" || x.state === "failed",
        );
        if (!done) {
          pollTimer.current = window.setTimeout(() => poll(id), 2500);
        }
      };

      await poll(json.batchId);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [
    enableFormula,
    enableTable,
    includeDocx,
    isOcr,
    items,
    language,
    modelVersion,
    resetPoll,
  ]);

  const downloadHref = useCallback(
    (zipUrl: string, inputName: string, format: "zip" | "md" | "json" | "docx") => {
      const params = new URLSearchParams({
        zipUrl,
        inputName,
        format,
      });
      return `/api/mineru/download?${params.toString()}`;
    },
    [],
  );

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">上传 PDF → 生成 Markdown / JSON / DOCX</h2>
            <p className="mt-1 text-sm text-zinc-600">
              文件会先上传到 Vercel Blob（统一存储），然后用 Mineru API 解析并产出结果。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={start}
              disabled={!canStart}
              className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {busy ? "处理中…" : "开始转换"}
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-zinc-900">选择 PDF（可多选）</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              disabled={busy}
              onChange={(e) => onChooseFiles(e.target.files)}
              className="mt-2 block w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-900"
            />
          </label>

          <div className="grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-zinc-900">模型版本</span>
                <select
                  value={modelVersion}
                  disabled={busy}
                  onChange={(e) => setModelVersion(e.target.value as ModelVersion)}
                  className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="pipeline">pipeline</option>
                  <option value="vlm">vlm</option>
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-zinc-900">语言</span>
                <input
                  value={language}
                  disabled={busy}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                  placeholder="ch"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeDocx}
                  disabled={busy}
                  onChange={(e) => setIncludeDocx(e.target.checked)}
                />
                <span>导出 DOCX</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isOcr}
                  disabled={busy}
                  onChange={(e) => setIsOcr(e.target.checked)}
                />
                <span>启用 OCR</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={enableFormula}
                  disabled={busy}
                  onChange={(e) => setEnableFormula(e.target.checked)}
                />
                <span>公式识别</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={enableTable}
                  disabled={busy}
                  onChange={(e) => setEnableTable(e.target.checked)}
                />
                <span>表格识别</span>
              </label>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {batchId ? (
          <div className="mt-4 text-sm text-zinc-600">
            Batch ID: <span className="font-mono text-zinc-900">{batchId}</span>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-6 py-4">
          <h3 className="text-sm font-semibold text-zinc-900">文件列表</h3>
        </div>
        <div className="divide-y divide-zinc-100">
          {items.length === 0 ? (
            <div className="px-6 py-8 text-sm text-zinc-500">还没有选择文件。</div>
          ) : (
            items.map((it) => {
              const state = it.mineru?.state ?? "—";
              const progress =
                it.mineru?.extract_progress?.total_pages && it.mineru?.extract_progress?.extracted_pages
                  ? `${it.mineru.extract_progress.extracted_pages}/${it.mineru.extract_progress.total_pages}`
                  : "";

              const zipUrl = it.mineru?.full_zip_url;
              const canDownload = it.mineru?.state === "done" && typeof zipUrl === "string";

              return (
                <div key={it.dataId} className="px-6 py-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-900">
                        {it.originalName}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600">
                        <span className="font-mono">{it.dataId}</span>
                        <span>{humanBytes(it.file.size)}</span>
                        <span>上传 {Math.round(it.uploadProgress)}%</span>
                        <span>状态 {state}</span>
                        {progress ? <span>页 {progress}</span> : null}
                        {it.mineru?.state === "failed" && it.mineru?.err_msg ? (
                          <span className="text-red-700">{it.mineru.err_msg}</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        className={`inline-flex h-9 items-center justify-center rounded-full border px-3 text-sm ${
                          canDownload
                            ? "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
                            : "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-400"
                        }`}
                        href={canDownload ? downloadHref(zipUrl!, it.originalName, "zip") : undefined}
                      >
                        ZIP
                      </a>
                      <a
                        className={`inline-flex h-9 items-center justify-center rounded-full border px-3 text-sm ${
                          canDownload
                            ? "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
                            : "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-400"
                        }`}
                        href={canDownload ? downloadHref(zipUrl!, it.originalName, "md") : undefined}
                      >
                        MD
                      </a>
                      <a
                        className={`inline-flex h-9 items-center justify-center rounded-full border px-3 text-sm ${
                          canDownload
                            ? "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
                            : "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-400"
                        }`}
                        href={canDownload ? downloadHref(zipUrl!, it.originalName, "json") : undefined}
                      >
                        JSON
                      </a>
                      <a
                        className={`inline-flex h-9 items-center justify-center rounded-full border px-3 text-sm ${
                          canDownload
                            ? "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
                            : "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-400"
                        }`}
                        href={canDownload ? downloadHref(zipUrl!, it.originalName, "docx") : undefined}
                      >
                        DOCX
                      </a>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="border-t border-zinc-100 px-6 py-4 text-xs text-zinc-500">
          {allDone ? "全部任务已完成（done/failed）。" : "解析过程中会自动轮询状态。"}
        </div>
      </div>
    </section>
  );
}
