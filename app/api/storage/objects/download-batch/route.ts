import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMeetingObjectBuffer } from "@/lib/objectStorage";
import { canUserAccessStorageObject } from "@/lib/storageObjectAcl";
import { findStorageObjectsByIds, findStorageObjectsByOwner } from "@/lib/storageObjectDb";
import { createStoredZip } from "@/lib/zip";
import type { StorageObjectRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeName(value: string | undefined, fallback: string) {
  return (value || fallback).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 160) || fallback;
}

function zipResponse(zip: Buffer, fileName: string) {
  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.byteLength),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store"
    }
  });
}

async function filterAccessibleObjects(objects: StorageObjectRecord[], currentUser: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  if (currentUser.role === "总裁") return objects;
  const accessible: StorageObjectRecord[] = [];
  for (const object of objects) {
    if (await canUserAccessStorageObject(object.id, currentUser.id)) accessible.push(object);
  }
  return accessible;
}

async function objectsFromRequest(request: Request) {
  const { searchParams } = new URL(request.url);
  const objectIds = searchParams.getAll("objectId").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  if (objectIds.length) return findStorageObjectsByIds(objectIds);

  const ownerType = searchParams.get("ownerType")?.trim();
  const ownerId = searchParams.get("ownerId")?.trim();
  const category = searchParams.get("category")?.trim() || undefined;
  if (!ownerType || !ownerId) return [];
  return findStorageObjectsByOwner(ownerType, ownerId, category);
}

export async function GET(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const objects = await filterAccessibleObjects(await objectsFromRequest(request), currentUser);
  if (!objects.length) return NextResponse.json({ error: "no downloadable objects" }, { status: 404 });

  const entries = [];
  for (const object of objects) {
    entries.push({
      name: safeName(object.originalName, `${object.category}-${object.id}.bin`),
      data: await getMeetingObjectBuffer(object.objectKey)
    });
  }

  return zipResponse(createStoredZip(entries), `meeting-download-${Date.now()}.zip`);
}
