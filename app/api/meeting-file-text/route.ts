import { NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE_BYTES = 12 * 1024 * 1024;

function isDocxFile(file: File) {
  return file.name.toLowerCase().endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function isTextFile(file: File) {
  return file.name.toLowerCase().endsWith(".txt") || file.type.startsWith("text/");
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "missing file" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: "file too large" }, { status: 413 });
    }

    if (isTextFile(file)) {
      return NextResponse.json({
        fileName: file.name,
        text: await file.text(),
        sourceType: "txt"
      });
    }

    if (isDocxFile(file)) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await mammoth.extractRawText({ buffer });
      return NextResponse.json({
        fileName: file.name,
        text: result.value.trim(),
        sourceType: "docx",
        warnings: result.messages.map((message) => message.message)
      });
    }

    return NextResponse.json({ error: "unsupported file type" }, { status: 415 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "meeting file text extraction failed",
        detail: error instanceof Error ? error.message : "unknown error"
      },
      { status: 500 }
    );
  }
}
