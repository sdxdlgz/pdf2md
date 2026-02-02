import {
  createMineruFileUrlsBatch,
  type MineruExtraFormat,
  type MineruModelVersion,
} from "@/lib/mineru";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSafeDataId(dataId: string): boolean {
  return /^[A-Za-z0-9._-]{1,128}$/.test(dataId);
}

function isAllowedModelVersion(value: unknown): value is MineruModelVersion {
  return value === "pipeline" || value === "vlm" || value === "MinerU-HTML";
}

function isAllowedExtraFormat(value: unknown): value is MineruExtraFormat {
  return value === "docx" || value === "html" || value === "latex";
}

function isAllowedStoredFileUrl(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return host === "blob.vercel-storage.com" || host.endsWith(".blob.vercel-storage.com");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchStoredFileWithRetries(sourceUrl: string): Promise<Response> {
  const maxAttempts = 4;
  const retryableStatuses = new Set([502, 503, 504]);

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(sourceUrl, { method: "GET", cache: "no-store" });
      if (res.ok) return res;
      if (!retryableStatuses.has(res.status) || attempt === maxAttempts) {
        return res;
      }
      const delayMs = 500 * Math.pow(2, attempt - 1);
      await sleep(delayMs);
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;
      const delayMs = 500 * Math.pow(2, attempt - 1);
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to fetch stored file.");
}

async function uploadUrlToMineruPutUrl(input: {
  sourceUrl: string;
  putUrl: string;
}): Promise<void> {
  const sourceRes = await fetchStoredFileWithRetries(input.sourceUrl);
  if (!sourceRes.ok) {
    const bodyPreview = await sourceRes.text().catch(() => "");
    throw new Error(
      `Failed to fetch stored file: HTTP ${sourceRes.status} ${sourceRes.statusText}${bodyPreview ? `: ${bodyPreview.slice(0, 200)}` : ""}`,
    );
  }
  if (!sourceRes.body) {
    throw new Error("Stored file response has no body.");
  }

  const contentLength = sourceRes.headers.get("content-length");
  const headers: Record<string, string> = {};
  if (contentLength) headers["Content-Length"] = contentLength;

  type DuplexRequestInit = RequestInit & { duplex: "half" };
  const putInit: DuplexRequestInit = {
    method: "PUT",
    body: sourceRes.body,
    duplex: "half",
    headers: Object.keys(headers).length ? headers : undefined,
  };

  const putRes = await fetch(input.putUrl, putInit);
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => "");
    throw new Error(
      `Mineru upload failed: HTTP ${putRes.status} ${putRes.statusText}${text ? `: ${text}` : ""}`,
    );
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (!isRecord(body) || !Array.isArray(body.files) || body.files.length < 1) {
    return NextResponse.json(
      { error: "`files` must be a non-empty array." },
      { status: 400 },
    );
  }
  if (body.files.length > 200) {
    return NextResponse.json(
      { error: "At most 200 files per batch." },
      { status: 400 },
    );
  }

  const files: Array<{ name: string; sourceUrl: string; data_id?: string }> = [];
  for (const file of body.files) {
    if (
      !isRecord(file) ||
      typeof file.name !== "string" ||
      !file.name ||
      (typeof file.blobUrl !== "string" || !file.blobUrl) &&
        (typeof file.blobDownloadUrl !== "string" || !file.blobDownloadUrl)
    ) {
      return NextResponse.json(
        { error: "Each file must include `name` and (`blobUrl` or `blobDownloadUrl`)." },
        { status: 400 },
      );
    }

    const sourceUrl =
      typeof file.blobDownloadUrl === "string" && file.blobDownloadUrl
        ? file.blobDownloadUrl
        : (file.blobUrl as string);

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(sourceUrl);
    } catch {
      return NextResponse.json(
        { error: `Invalid blob URL: ${sourceUrl}` },
        { status: 400 },
      );
    }
    if (!isAllowedStoredFileUrl(parsedUrl)) {
      return NextResponse.json(
        { error: "blobUrl must be a Vercel Blob URL (https)." },
        { status: 400 },
      );
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { error: `File name must end with .pdf: ${file.name}` },
        { status: 400 },
      );
    }

    const data_id =
      typeof file.data_id === "string" && file.data_id ? file.data_id : undefined;
    if (data_id && !isSafeDataId(data_id)) {
      return NextResponse.json(
        { error: `Invalid data_id: ${data_id}` },
        { status: 400 },
      );
    }
    files.push({ name: file.name, sourceUrl, data_id });
  }

  const model_version = isAllowedModelVersion(body.model_version)
    ? body.model_version
    : undefined;

  const extra_formats = Array.isArray(body.extra_formats)
    ? (body.extra_formats.filter(isAllowedExtraFormat) as MineruExtraFormat[])
    : undefined;

  const booleanOrUndefined = (v: unknown) =>
    typeof v === "boolean" ? v : undefined;

  const language =
    model_version === "pipeline" && typeof body.language === "string"
      ? body.language
      : undefined;
  if (model_version === "pipeline" && !language) {
    return NextResponse.json(
      { error: "`language` is required when model_version is pipeline." },
      { status: 400 },
    );
  }
  const page_ranges =
    typeof body.page_ranges === "string" ? body.page_ranges : undefined;

  try {
    const { batchId, fileUrls } = await createMineruFileUrlsBatch({
      files: files.map((f) => ({
        name: f.name,
        data_id: f.data_id,
        is_ocr: booleanOrUndefined(body.is_ocr),
        page_ranges,
      })),
      model_version,
      extra_formats,
      enable_formula: booleanOrUndefined(body.enable_formula),
      enable_table: booleanOrUndefined(body.enable_table),
      language,
    });

    if (fileUrls.length !== files.length) {
      throw new Error(
        `Mineru returned ${fileUrls.length} upload URLs for ${files.length} files.`,
      );
    }

    await mapWithConcurrency(
      files,
      1,
      async (file, index) =>
        uploadUrlToMineruPutUrl({ sourceUrl: file.sourceUrl, putUrl: fileUrls[index] }),
    );

    return NextResponse.json({ batchId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to create Mineru batch task.", detail: message },
      { status: 500 },
    );
  }
}
