import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readAiMeetingDraftJob } from "@/lib/aiMeetingDraftJobs";
import { isDbStateReadEnabled } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { jobId } = await context.params;
  const job = await readAiMeetingDraftJob(jobId, isDbStateReadEnabled());
  if (!job) return NextResponse.json({ error: "meeting draft job not found" }, { status: 404 });
  if (job.createdBy && job.createdBy !== currentUser.id && currentUser.role !== "总裁") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({ job });
}
