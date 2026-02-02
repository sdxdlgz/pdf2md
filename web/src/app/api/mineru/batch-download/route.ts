import { getFilenameBase, sanitizeAttachmentFilename } from "@/lib/filenames";
import archiver from "archiver";
import { PassThrough, Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { File } from "unzipper";
import directory from "unzipper/lib/Open/directory.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type OutputFormat = "zip" | "md" | "json" | "docx";

function isAllowedOutputFormat(value: unknown): value is OutputFormat {
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
  type DirectoryFn = (
    source: unknown,
    options: { tailSize: number },
  ) => Promise<DirectoryResult>;

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

  pool.sort(
    (a, b) => (b.file.uncompressedSize || 0) - (a.file.uncompressedSize || 0),
  );
  return pool[0]?.file ?? null;
}

type BatchDownloadFile = { zipUrl: string; inputName: string };

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const format = (body as { format?: unknown } | null)?.format;
  const files = (body as { files?: unknown } | null)?.files;

  if (!isAllowedOutputFormat(format)) {
    return Response.json(
      { error: "Invalid `format`. Use zip|md|json|docx." },
      { status: 400 },
    );
  }

  if (!Array.isArray(files) || files.length === 0) {
    return Response.json({ error: "Missing `files`." }, { status: 400 });
  }
  if (files.length > 200) {
    return Response.json(
      { error: "Too many files. Max 200." },
      { status: 400 },
    );
  }

  const validated: BatchDownloadFile[] = [];
  for (const file of files) {
    if (!file || typeof file !== "object") continue;
    const zipUrl = (file as { zipUrl?: unknown }).zipUrl;
    const inputName = (file as { inputName?: unknown }).inputName;
    if (typeof zipUrl !== "string" || typeof inputName !== "string") continue;

    let url: URL;
    try {
      url = new URL(zipUrl);
    } catch {
      continue;
    }
    if (!isAllowedZipUrl(url)) continue;

    validated.push({ zipUrl: url.toString(), inputName });
  }

  if (validated.length === 0) {
    return Response.json(
      { error: "No valid files to download." },
      { status: 400 },
    );
  }

  const output = new PassThrough();
  const archive = archiver("zip", {
    zlib: { level: 9 },
  });

  archive.on("error", (err) => {
    output.destroy(err);
  });
  archive.pipe(output);

  const usedNames = new Set<string>();
  const extension = format === "zip" ? ".zip" : `.${format}`;
  const store = format === "zip" || format === "docx";

  for (let index = 0; index < validated.length; index += 1) {
    const { zipUrl, inputName } = validated[index];
    const base = getFilenameBase(inputName);

    const filename = sanitizeAttachmentFilename(`${base}${extension}`);
    let entryName = filename;
    if (usedNames.has(entryName)) {
      const folder = sanitizeAttachmentFilename(`${base}-${index + 1}`);
      entryName = `${folder}/${filename}`;
    }
    usedNames.add(entryName);

    try {
      if (format === "zip") {
        const res = await fetch(zipUrl, { method: "GET", cache: "no-store" });
        if (!res.ok) {
          throw new Error(
            `Failed to fetch zip: HTTP ${res.status} ${res.statusText}`,
          );
        }
        if (!res.body) {
          throw new Error("Empty zip response.");
        }
        const nodeBody = Readable.fromWeb(
          res.body as unknown as NodeReadableStream<Uint8Array>,
        );
        archive.append(nodeBody, { name: entryName, store });
        continue;
      }

      const expectedFileName = `${base}${extension}`;
      const filesInZip = await listRemoteZipFiles(zipUrl);
      const picked = pickBestFile({
        files: filesInZip,
        extension,
        expectedFileName,
      });
      if (!picked) {
        throw new Error(`No ${format} found in zip.`);
      }

      archive.append(picked.stream(), { name: entryName, store });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const errorName = sanitizeAttachmentFilename(`${base}.error.txt`);
      let errorEntry = errorName;
      if (usedNames.has(errorEntry)) {
        const folder = sanitizeAttachmentFilename(`${base}-${index + 1}`);
        errorEntry = `${folder}/${errorName}`;
      }
      usedNames.add(errorEntry);
      archive.append(Buffer.from(message, "utf8"), { name: errorEntry });
    }
  }

  void archive.finalize();

  const stream = Readable.toWeb(output) as unknown as ReadableStream<Uint8Array>;
  const headers = new Headers();
  headers.set("Content-Type", "application/zip");
  headers.set("Cache-Control", "no-store");
  headers.set(
    "Content-Disposition",
    `attachment; filename="${sanitizeAttachmentFilename(`pdf2md-${format}.zip`)}"`,
  );
  return new Response(stream, { status: 200, headers });
}

