import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { readNotificationReadIdsDb, replaceNotificationReadIdsDb } from "@/lib/dbWriteStore";
import { updateLocalStateWith, readLocalState } from "@/lib/localStateStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReadBody = {
  readIds?: unknown;
};

function normalizeReadIds(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))].slice(0, 1000);
}

function unauthorized() {
  return NextResponse.json({ error: "not authenticated" }, { status: 401 });
}

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return unauthorized();

  if (isDbStateReadEnabled()) {
    const readIds = await readNotificationReadIdsDb(currentUser);
    return NextResponse.json({ readIds });
  }

  const state = await readLocalState();
  return NextResponse.json({ readIds: state.notificationReadIdsByUser[currentUser.id] ?? [] });
}

export async function PUT(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as ReadBody;
  const readIds = normalizeReadIds(body.readIds);
  if (!readIds) {
    return NextResponse.json({ error: "readIds must be an array" }, { status: 400 });
  }

  if (isDbStateReadEnabled()) {
    return NextResponse.json({ readIds: await replaceNotificationReadIdsDb(currentUser, readIds) });
  }

  const state = await updateLocalStateWith((current) => ({
    ...current,
    notificationReadIdsByUser: {
      ...(current.notificationReadIdsByUser ?? {}),
      [currentUser.id]: readIds
    }
  }));

  return NextResponse.json({ readIds: state.notificationReadIdsByUser[currentUser.id] ?? [] });
}
