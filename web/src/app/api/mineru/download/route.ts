import { getFilenameBase, sanitizeAttachmentFilename } from "@/lib/filenames";
import { PassThrough, Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { File } from "unzipper";
import directory from "unzipper/lib/Open/directory.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type OutputFormat = "zip" | "md" | "json" | "docx";

function isAllowedOutputFormat(value: string | null): value is OutputFormat {
  return (
    value === "zip" || value === "md" || value === "json" || value === "docx"
  );
}

function isAllowedZipUrl(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  if (!url.pathname.toLowerCase().endsWith(".zip")) return false;
  const host = url.hostname.toLowerCase();
  return (
    host === "cdn-mineru.openxlab.org.cn" ||
    host.endsWith(".openxlab.org.cn") ||
    host.endsWith(".aliyuncs.com")
  );
}

async function fetchZip(zipUrl: string): Promise<Response> {
  const res = await fetch(zipUrl, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Failed to fetch zip: HTTP ${res.status} ${res.statusText}`);
  }
  return res;
}

async function getRemoteZipSize(zipUrl: string): Promise<number> {
  const head = await fetch(zipUrl, { method: "HEAD" });
  if (head.ok) {
    const sizeHeader = head.headers.get("content-length");
    if (sizeHeader) {
      const parsed = Number(sizeHeader);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }

  const rangeRes = await fetch(zipUrl, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
  });
  if (!rangeRes.ok) {
    throw new Error(
      `Failed to get zip size: HTTP ${rangeRes.status} ${rangeRes.statusText}`,
    );
  }

  const contentRange = rangeRes.headers.get("content-range");
  if (contentRange) {
    const total = Number(contentRange.split("/")[1]);
    if (Number.isFinite(total) && total > 0) return total;
  }

  const sizeHeader = rangeRes.headers.get("content-length");
  if (sizeHeader) {
    const parsed = Number(sizeHeader);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  throw new Error("Failed to determine zip size.");
}

function createRemoteZipRangeStream(
  zipUrl: string,
  offset: number,
  length?: number,
): PassThrough {
  const pass = new PassThrough();
  const end = typeof length === "number" ? offset + length : "";
  const range = `bytes=${offset}-${end}`;

  void fetch(zipUrl, {
    method: "GET",
    headers: { Range: range },
    cache: "no-store",
  })
    .then((res) => {
      if (!res.ok) {
        throw new Error(
          `Range fetch failed: HTTP ${res.status} ${res.statusText}`,
        );
      }
      if (!res.body) {
        pass.end();
        return;
      }

      const nodeBody = res.body as unknown as NodeReadableStream<Uint8Array>;
      Readable.fromWeb(nodeBody).pipe(pass);
    })
    .catch((err: unknown) => {
      pass.destroy(err instanceof Error ? err : new Error("Range fetch failed."));
    });

  return pass;
}

async function listRemoteZipFiles(zipUrl: string): Promise<File[]> {
  const source = {
    stream: (offset: number, length?: number) =>
      createRemoteZipRangeStream(zipUrl, offset, length),
    size: async () => getRemoteZipSize(zipUrl),
  };

  type DirectoryResult = { files: Promise<File[]> };
  type DirectoryFn = (source: unknown, options: { tailSize: number }) => Promise<DirectoryResult>;

  const dir = await (directory as unknown as DirectoryFn)(source, {
    tailSize: 128 * 1024,
  });

  return dir.files;
}

function pickBestFile(options: {
  files: File[];
  extension: string;
  expectedFileName?: string;
}): File | null {
  const extensionLower = options.extension.toLowerCase();
  const expectedLower = options.expectedFileName?.toLowerCase();

  const candidates = options.files
    .filter((f) => f.type === "File")
    .filter((f) => f.path.toLowerCase().endsWith(extensionLower))
    .map((f) => {
      const lowerPath = f.path.toLowerCase();
      const exact = Boolean(expectedLower && lowerPath.endsWith(expectedLower));
      return { file: f, exact };
    });

  if (candidates.length === 0) return null;
  const exactMatches = candidates.filter((c) => c.exact);
  const pool = exactMatches.length > 0 ? exactMatches : candidates;

  pool.sort((a, b) => (b.file.uncompressedSize || 0) - (a.file.uncompressedSize || 0));
  return pool[0]?.file ?? null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const zipUrlParam = searchParams.get("zipUrl");
  const inputName = searchParams.get("inputName") ?? "document.pdf";
  const formatParam = searchParams.get("format") ?? "zip";

  if (!zipUrlParam) {
    return Response.json({ error: "Missing `zipUrl`." }, { status: 400 });
  }
  if (!isAllowedOutputFormat(formatParam)) {
    return Response.json(
      { error: "Invalid `format`. Use zip|md|json|docx." },
      { status: 400 },
    );
  }

  let zipUrl: URL;
  try {
    zipUrl = new URL(zipUrlParam);
  } catch {
    return Response.json({ error: "Invalid `zipUrl`." }, { status: 400 });
  }
  if (!isAllowedZipUrl(zipUrl)) {
    return Response.json(
      { error: "zipUrl host/path not allowed." },
      { status: 400 },
    );
  }

  const base = getFilenameBase(inputName);

  if (formatParam === "zip") {
    try {
      const res = await fetchZip(zipUrl.toString());
      const filename = sanitizeAttachmentFilename(`${base}.zip`);
      const headers = new Headers();
      headers.set("Content-Type", "application/zip");
      headers.set(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      headers.set("Cache-Control", "no-store");
      return new Response(res.body, { status: 200, headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return Response.json(
        { error: "Failed to download zip.", detail: message },
        { status: 502 },
      );
    }
  }

  const extension = `.${formatParam}`;
  const expectedFileName = `${base}${extension}`;

  try {
    const files = await listRemoteZipFiles(zipUrl.toString());
    const file = pickBestFile({
      files,
      extension,
      expectedFileName,
    });
    if (!file) {
      return Response.json(
        { error: `No ${formatParam} found in zip.` },
        { status: 404 },
      );
    }

    const nodeStream = file.stream();
    const stream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

    const contentType =
      formatParam === "md"
        ? "text/markdown; charset=utf-8"
        : formatParam === "json"
          ? "application/json; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    const filename = sanitizeAttachmentFilename(`${base}${extension}`);

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    headers.set("Cache-Control", "no-store");
    if (typeof file.uncompressedSize === "number" && file.uncompressedSize > 0) {
      headers.set("Content-Length", String(file.uncompressedSize));
    }

    return new Response(stream, { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Failed to extract ${formatParam} from zip.`, detail: message },
      { status: 502 },
    );
  }
}
