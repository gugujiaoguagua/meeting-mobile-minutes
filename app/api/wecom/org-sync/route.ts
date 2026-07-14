import { NextResponse } from "next/server";
import { canResetState, getCurrentUser } from "@/lib/auth";
import { getWecomOrgSyncStats, syncWecomOrgToSystem } from "@/lib/wecomOrgSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function forbiddenResponse(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return forbiddenResponse(401, "not authenticated");
  if (!canResetState(currentUser)) return forbiddenResponse(403, "forbidden");

  const stats = await getWecomOrgSyncStats();
  return NextResponse.json(stats);
}

export async function POST() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return forbiddenResponse(401, "not authenticated");
  if (!canResetState(currentUser)) return forbiddenResponse(403, "forbidden");

  const result = await syncWecomOrgToSystem();
  return NextResponse.json(result);
}
