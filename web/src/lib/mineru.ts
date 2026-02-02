import { getRequiredEnv } from "@/lib/env";

const MINERU_API_BASE = "https://mineru.net/api/v4";

export type MineruModelVersion = "pipeline" | "vlm" | "MinerU-HTML";

export type MineruTaskState =
  | "done"
  | "waiting-file"
  | "pending"
  | "running"
  | "failed"
  | "converting";

export type MineruExtraFormat = "docx" | "html" | "latex";

export type MineruExtractProgress = {
  extracted_pages: number;
  total_pages: number;
  start_time: string;
};

export type MineruBatchResultItem = {
  file_name: string;
  state: MineruTaskState;
  err_msg?: string;
  full_zip_url?: string;
  data_id?: string;
  extract_progress?: MineruExtractProgress;
};

export type MineruBatchResultsData = {
  batch_id: string;
  extract_result: MineruBatchResultItem[];
};

export type MineruFileUrlsBatchData = {
  batch_id: string;
  file_urls: string[];
};

type MineruApiResponse<T> = {
  code: number;
  msg: string;
  trace_id: string;
  data: T;
};

function getMineruToken(): string {
  return getRequiredEnv("MINERU_API_TOKEN");
}

async function mineruFetchJson<T>(
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
): Promise<MineruApiResponse<T>> {
  const token = getMineruToken();
  const url = `${MINERU_API_BASE}${path}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  let json: MineruApiResponse<T> | undefined;
  try {
    json = JSON.parse(text) as MineruApiResponse<T>;
  } catch {
    // fall through
  }

  if (!res.ok) {
    const detail = json ? JSON.stringify(json) : text;
    throw new Error(`Mineru HTTP ${res.status} ${res.statusText}: ${detail}`);
  }
  if (!json) {
    throw new Error(`Mineru returned non-JSON response: ${text}`);
  }
  return json;
}

export async function createMineruUrlBatchTask(input: {
  files: Array<{ url: string; data_id?: string }>;
  model_version?: MineruModelVersion;
  extra_formats?: MineruExtraFormat[];
  is_ocr?: boolean;
  enable_formula?: boolean;
  enable_table?: boolean;
  language?: string;
  page_ranges?: string;
  callback?: string;
  seed?: string;
}): Promise<{ batchId: string }> {
  const res = await mineruFetchJson<{ batch_id: string }>(
    "/extract/task/batch",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );

  if (res.code !== 0) {
    throw new Error(`Mineru error ${res.code}: ${res.msg}`);
  }
  return { batchId: res.data.batch_id };
}

export async function createMineruFileUrlsBatch(input: {
  files: Array<{
    name: string;
    data_id?: string;
    is_ocr?: boolean;
    page_ranges?: string;
  }>;
  model_version?: MineruModelVersion;
  extra_formats?: MineruExtraFormat[];
  enable_formula?: boolean;
  enable_table?: boolean;
  language?: string;
  callback?: string;
  seed?: string;
}): Promise<{ batchId: string; fileUrls: string[] }> {
  const res = await mineruFetchJson<MineruFileUrlsBatchData>("/file-urls/batch", {
    method: "POST",
    body: JSON.stringify(input),
  });

  if (res.code !== 0) {
    throw new Error(`Mineru error ${res.code}: ${res.msg}`);
  }
  return { batchId: res.data.batch_id, fileUrls: res.data.file_urls };
}

export async function getMineruBatchResults(batchId: string): Promise<{
  batchId: string;
  results: MineruBatchResultItem[];
}> {
  const res = await mineruFetchJson<MineruBatchResultsData>(
    `/extract-results/batch/${encodeURIComponent(batchId)}`,
    { method: "GET" },
  );

  if (res.code !== 0) {
    throw new Error(`Mineru error ${res.code}: ${res.msg}`);
  }
  return { batchId: res.data.batch_id, results: res.data.extract_result };
}
