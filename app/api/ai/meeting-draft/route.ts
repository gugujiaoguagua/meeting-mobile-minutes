import { NextResponse } from "next/server";
import { generateMeetingDraftWithDeepSeek, MeetingDraftValidationError } from "@/lib/aiMeetingDraft";
import type { AiMeetingDraftRequest } from "@/lib/aiMeetingDraft";
import { applyMeetingDictionaryCorrections, listMeetingDictionaryEntries } from "@/lib/meetingDictionary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidRequest(body: Partial<AiMeetingDraftRequest>): body is AiMeetingDraftRequest {
  return Boolean(body.meetingId && body.title && body.departmentId && body.hostId && typeof body.transcript === "string");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<AiMeetingDraftRequest>;
    if (!isValidRequest(body)) {
      return NextResponse.json({ error: "invalid meeting draft request" }, { status: 400 });
    }

    const dictionaryEntries = await listMeetingDictionaryEntries();
    const dictionaryResult = applyMeetingDictionaryCorrections(body.transcript, dictionaryEntries);
    const draft = await generateMeetingDraftWithDeepSeek({ ...body, transcript: dictionaryResult.correctedText });
    return NextResponse.json({
      ...draft,
      correctedTranscript: dictionaryResult.correctedText,
      dictionaryCorrections: dictionaryResult.corrections
    });
  } catch (error) {
    if (error instanceof MeetingDraftValidationError) {
      return NextResponse.json(
        {
          error: "meeting draft validation failed",
          detail: error.message
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      {
        error: "deepseek meeting draft failed",
        detail: error instanceof Error ? error.message : "unknown error"
      },
      { status: 502 }
    );
  }
}
