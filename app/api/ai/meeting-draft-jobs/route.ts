import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { generateMeetingDraftWithDeepSeek, MeetingDraftValidationError, type AiMeetingDraftRequest } from "@/lib/aiMeetingDraft";
import {
  createAiMeetingDraftJob,
  markAiMeetingDraftJobFailed,
  markAiMeetingDraftJobProcessing,
  markAiMeetingDraftJobSucceeded,
  nextAiMeetingDraftJobId
} from "@/lib/aiMeetingDraftJobs";
import { isDbStateReadEnabled } from "@/lib/db";
import { applyMeetingDictionaryCorrections, listMeetingDictionaryEntries } from "@/lib/meetingDictionary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidRequest(body: Partial<AiMeetingDraftRequest>): body is AiMeetingDraftRequest {
  return Boolean(body.meetingId && body.title && body.departmentId && body.hostId && typeof body.transcript === "string");
}

async function runMeetingDraftJob(jobId: string, request: AiMeetingDraftRequest, useDb: boolean) {
  await markAiMeetingDraftJobProcessing(jobId, useDb);
  try {
    const dictionaryEntries = await listMeetingDictionaryEntries();
    const dictionaryResult = applyMeetingDictionaryCorrections(request.transcript, dictionaryEntries);
    const draft = await generateMeetingDraftWithDeepSeek({ ...request, transcript: dictionaryResult.correctedText });
    await markAiMeetingDraftJobSucceeded(
      jobId,
      {
        ...draft,
        correctedTranscript: dictionaryResult.correctedText,
        dictionaryCorrections: dictionaryResult.corrections
      },
      useDb
    );
  } catch (error) {
    const isValidationError = error instanceof MeetingDraftValidationError;
    await markAiMeetingDraftJobFailed(
      jobId,
      isValidationError ? "meeting draft validation failed" : "deepseek meeting draft failed",
      error instanceof Error ? error.message : "unknown error",
      useDb
    );
    throw error;
  }
}

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Partial<AiMeetingDraftRequest>;
  if (!isValidRequest(body)) {
    return NextResponse.json({ error: "invalid meeting draft request" }, { status: 400 });
  }

  const useDb = isDbStateReadEnabled();
  const job = await createAiMeetingDraftJob({
    id: nextAiMeetingDraftJobId(),
    request: body,
    createdBy: currentUser.id,
    useDb
  });

  void runMeetingDraftJob(job.id, body, useDb).catch((error) => {
    console.warn("ai_meeting_draft_background_job_failed", {
      jobId: job.id,
      message: error instanceof Error ? error.message : "unknown_error"
    });
  });

  return NextResponse.json({ job }, { status: 202 });
}
