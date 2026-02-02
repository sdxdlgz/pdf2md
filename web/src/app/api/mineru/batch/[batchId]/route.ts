import { getMineruBatchResults } from "@/lib/mineru";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const { batchId } = await context.params;
  if (!batchId) {
    return NextResponse.json({ error: "Missing batchId." }, { status: 400 });
  }

  try {
    const { results } = await getMineruBatchResults(batchId);
    return NextResponse.json({ batchId, results }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch Mineru batch results.", detail: message },
      { status: 500 },
    );
  }
}
