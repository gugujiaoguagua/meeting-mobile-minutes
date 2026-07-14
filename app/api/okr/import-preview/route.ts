import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { generateOkrImportDraftWithDeepSeek } from "@/lib/okrImportDraft";
import type { SpreadsheetWorkbookPayload } from "@/lib/okrSpreadsheetTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  try {
    const body = (await request.json().catch(() => ({}))) as { text?: string; sourceName?: string; spreadsheet?: SpreadsheetWorkbookPayload };
    const source = body.text?.trim() ?? "";
    if (!source) return NextResponse.json({ error: "missing import text" }, { status: 400 });

    const draft = await generateOkrImportDraftWithDeepSeek(source, body.sourceName, body.spreadsheet);
    return NextResponse.json(draft);
  } catch (error) {
    return NextResponse.json(
      {
        error: "okr import preview failed",
        detail: error instanceof Error ? error.message : "unknown error"
      },
      { status: 500 }
    );
  }
}
