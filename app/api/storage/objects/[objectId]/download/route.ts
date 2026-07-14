import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMeetingObjectBuffer } from "@/lib/objectStorage";
import { canUserAccessStorageObject } from "@/lib/storageObjectAcl";
import { findStorageObject } from "@/lib/storageObjectDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function downloadName(name: string | undefined, fallback: string) {
  return (name || fallback).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 160) || fallback;
}

function contentDisposition(fileName: string) {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(_request: Request, context: { params: Promise<{ objectId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { objectId } = await context.params;
  const object = await findStorageObject(objectId);
  if (!object) return NextResponse.json({ error: "object not found" }, { status: 404 });

  const canAccess = currentUser.role === "总裁" || (await canUserAccessStorageObject(object.id, currentUser.id));
  if (!canAccess) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await getMeetingObjectBuffer(object.objectKey);
  const fileName = downloadName(object.originalName, `${object.id}.bin`);
  return new Response(body, {
    headers: {
      "Content-Type": object.mimeType || "application/octet-stream",
      "Content-Length": String(body.byteLength),
      "Content-Disposition": contentDisposition(fileName),
      "Cache-Control": "private, no-store"
    }
  });
}
