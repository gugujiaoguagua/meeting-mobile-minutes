import { NextResponse } from "next/server";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { saveImportedFileObject } from "@/lib/importFileStorage";
import type { SpreadsheetWorkbookPayload } from "@/lib/okrSpreadsheetTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE_BYTES = 12 * 1024 * 1024;

function isDocxFile(file: File) {
  return file.name.toLowerCase().endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function isTextFile(file: File) {
  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith(".txt") || lowerName.endsWith(".csv") || lowerName.endsWith(".tsv") || file.type.startsWith("text/");
}

function isSpreadsheetFile(file: File) {
  const lowerName = file.name.toLowerCase();
  return (
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".xls") ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "application/vnd.ms-excel"
  );
}

function spreadsheetToWorkbook(buffer: Buffer): SpreadsheetWorkbookPayload {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  return {
    sheets: workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        blankrows: false,
        defval: "",
        raw: false,
        dateNF: "yyyy-mm-dd"
      }) as unknown[][];
      return {
        name: sheetName,
        rows: rows.map((row) => row.map((cell) => String(cell ?? "").trim()))
      };
    })
  };
}

function spreadsheetToText(workbook: SpreadsheetWorkbookPayload) {
  return workbook.sheets
    .map((sheet) => {
      const text = sheet.rows.map((row) => row.join("\t")).join("\n").trim();
      return [`# ${sheet.name}`, text].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function storagePayload(record: Awaited<ReturnType<typeof saveImportedFileObject>>) {
  if (!record) return undefined;
  return {
    id: record.id,
    ownerType: record.ownerType,
    ownerId: record.ownerId,
    category: record.category,
    originalName: record.originalName,
    sizeBytes: record.sizeBytes,
    mimeType: record.mimeType
  };
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "missing file" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: "file too large" }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const storedObject = currentUser
      ? await saveImportedFileObject({
          fileName: file.name,
          mimeType: file.type || undefined,
          body: buffer,
          currentUser,
          ownerType: typeof formData.get("ownerType") === "string" ? String(formData.get("ownerType")) : undefined,
          ownerId: typeof formData.get("ownerId") === "string" ? String(formData.get("ownerId")) : undefined
        })
      : undefined;

    if (isTextFile(file)) {
      return NextResponse.json({
        fileName: file.name,
        text: buffer.toString("utf8"),
        sourceType: "txt",
        storageObject: storagePayload(storedObject)
      });
    }

    if (isDocxFile(file)) {
      const result = await mammoth.extractRawText({ buffer });
      return NextResponse.json({
        fileName: file.name,
        text: result.value.trim(),
        sourceType: "docx",
        storageObject: storagePayload(storedObject),
        warnings: result.messages.map((message) => message.message)
      });
    }

    if (isSpreadsheetFile(file)) {
      const spreadsheet = spreadsheetToWorkbook(buffer);
      return NextResponse.json({
        fileName: file.name,
        text: spreadsheetToText(spreadsheet),
        spreadsheet,
        sourceType: "xlsx",
        storageObject: storagePayload(storedObject)
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
