import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getObjectStoragePublicConfig } from "@/lib/objectStorage";
import { readStorageStats, readStorageTotals } from "@/lib/storageStats";

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "总裁") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [totals, groups] = await Promise.all([readStorageTotals(), readStorageStats()]);
  return NextResponse.json({
    objectStorage: getObjectStoragePublicConfig(),
    totals,
    groups
  });
}
