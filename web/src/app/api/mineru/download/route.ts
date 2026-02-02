import { getFilenameBase, sanitizeAttachmentFilename } from "@/lib/filenames";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import Parse from "unzipper/lib/parse.js";
import type { Entry } from "unzipper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type OutputFormat = "zip" | "md" | "json" | "docx";

function isAllowedOutputFormat(value: string | null): value is OutputFormat {
  return value === "zip" || value === "md" || value === "json" || value === "docx";
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

async function pickBestEntryPath(options: {
  zipUrl: string;
  extension: string;
  expectedFileName?: string;
}): Promise<string | null> {
  const res = await fetchZip(options.zipUrl);
  if (!res.body) return null;

  const nodeBody = res.body as unknown as NodeReadableStream<Uint8Array>;
  const nodeStream = Readable.fromWeb(nodeBody);
  const parser = nodeStream.pipe(Parse({ forceStream: true })) as unknown as AsyncIterable<Entry>;

  type Candidate = { path: string; size: number; exact: boolean };
  const candidates: Candidate[] = [];

  for await (const entry of parser) {
    const entryType = String(entry.type ?? "");
    const entryPath = String(entry.path ?? "");
    if (entryType !== "File" || !entryPath) {
      entry.autodrain();
      continue;
    }

    const lowerPath = entryPath.toLowerCase();
    if (!lowerPath.endsWith(options.extension.toLowerCase())) {
      entry.autodrain();
      continue;
    }

    const size =
      typeof entry.extra?.uncompressedSize === "number"
        ? entry.extra.uncompressedSize
        : typeof entry.vars?.compressedSize === "number"
          ? entry.vars.compressedSize
          : 0;

    const exact = Boolean(
      options.expectedFileName &&
        lowerPath.endsWith(options.expectedFileName.toLowerCase()),
    );

    candidates.push({ path: entryPath, size, exact });
    entry.autodrain();
  }

  if (candidates.length === 0) return null;
  const exactMatches = candidates.filter((c) => c.exact);
  const pool = exactMatches.length > 0 ? exactMatches : candidates;
  pool.sort((a, b) => b.size - a.size);
  return pool[0]?.path ?? null;
}

async function streamZipEntry(options: {
  zipUrl: string;
  entryPath: string;
}): Promise<ReadableStream<Uint8Array>> {
  const res = await fetchZip(options.zipUrl);
  if (!res.body) throw new Error("Zip response has no body.");

  const nodeBody = res.body as unknown as NodeReadableStream<Uint8Array>;
  const nodeStream = Readable.fromWeb(nodeBody);
  const parser = nodeStream.pipe(Parse({ forceStream: true })) as unknown as AsyncIterable<Entry>;

  for await (const entry of parser) {
    const entryType = String(entry.type ?? "");
    const entryPath = String(entry.path ?? "");
    if (entryType === "File" && entryPath === options.entryPath) {
      return Readable.toWeb(entry) as unknown as ReadableStream<Uint8Array>;
    }
    entry.autodrain();
  }

  throw new Error("Entry not found in zip.");
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
    const entryPath = await pickBestEntryPath({
      zipUrl: zipUrl.toString(),
      extension,
      expectedFileName,
    });
    if (!entryPath) {
      return Response.json(
        { error: `No ${formatParam} found in zip.` },
        { status: 404 },
      );
    }

    const stream = await streamZipEntry({
      zipUrl: zipUrl.toString(),
      entryPath,
    });

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

    return new Response(stream, { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Failed to extract ${formatParam} from zip.`, detail: message },
      { status: 502 },
    );
  }
}
