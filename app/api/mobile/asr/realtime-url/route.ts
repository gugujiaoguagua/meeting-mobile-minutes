import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createTencentRealtimeAsrUrl, isTencentRealtimeAsrConfigured } from "@/lib/tencentAsr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (!isTencentRealtimeAsrConfigured()) {
    return NextResponse.json({ error: "tencent realtime asr not configured" }, { status: 501 });
  }

  const realtime = createTencentRealtimeAsrUrl();
  if (!realtime) {
    return NextResponse.json({ error: "tencent realtime asr url unavailable" }, { status: 500 });
  }

  return NextResponse.json({ realtime });
}
