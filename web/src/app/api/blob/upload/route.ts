import { handleUpload } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 200 * 1024 * 1024;

export async function POST(request: Request) {
  const body = await request.json();

  const response = await handleUpload({
    request,
    body,
    onBeforeGenerateToken: async (pathname) => {
      if (!pathname.startsWith("uploads/")) {
        throw new Error("Invalid upload path.");
      }
      if (!pathname.toLowerCase().endsWith(".pdf")) {
        throw new Error("Only .pdf files are supported.");
      }

      return {
        allowedContentTypes: ["application/pdf"],
        maximumSizeInBytes: MAX_FILE_BYTES,
        addRandomSuffix: false,
        allowOverwrite: false,
      };
    },
  });

  return NextResponse.json(response);
}

