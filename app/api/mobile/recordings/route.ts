import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { saveRecordedMeetingDb, updateRecordedMeetingTranscriptionDb } from "@/lib/dbWriteStore";
import { updateLocalStateWith } from "@/lib/localStateStore";
import { transcribeAudioWithTencentAsr, type TencentAsrResult } from "@/lib/tencentAsr";
import type { Meeting } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_SIZE_BYTES = 80 * 1024 * 1024;

function safeFileName(value: string) {
  return value.replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_").slice(0, 120) || "mobile-recording.webm";
}

function dayStamp(date: Date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function isAudioFile(file: File) {
  const name = file.name.toLowerCase();
  return file.type.startsWith("audio/") || /\.(webm|m4a|mp3|wav|ogg|aac)$/i.test(name);
}

function usableBrowserTranscript(value: string) {
  return value.length >= 20 ? value : "";
}

function asrStatusMessage(status: Awaited<ReturnType<typeof transcribeAudioWithTencentAsr>>) {
  if (status.status === "success") return "";
  if (status.status === "skipped") return "语音识别服务尚未配置或当前音频不满足云端识别条件。";
  if (status.status === "pending") return "语音识别任务已提交，但本次请求等待超时，需稍后重试。";
  return status.message || "语音识别暂未返回可用转写。";
}

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function finalStatusMessage(status: TencentAsrResult) {
  if (status.status === "success") return "云端精修转写已完成。";
  return asrStatusMessage(status);
}

async function updateRecordingMeeting(meetingId: string, update: Partial<Meeting>) {
  if (isDbStateReadEnabled()) {
    await updateRecordedMeetingTranscriptionDb(meetingId, update);
    return;
  }

  await updateLocalStateWith((state) => ({
    ...state,
    meetings: state.meetings.map((meeting) => (meeting.id === meetingId ? { ...meeting, ...update } : meeting))
  }));
}

async function finalizeRecordingTranscription(input: { meetingId: string; storedPath: string; mimeType: string; browserTranscript: string }) {
  try {
    const asrResult = await transcribeAudioWithTencentAsr({
      filePath: input.storedPath,
      mimeType: input.mimeType
    });
    const transcript = asrResult.status === "success" ? asrResult.transcript : usableBrowserTranscript(input.browserTranscript);
    const isTranscribed = transcript.length > 0;
    const now = new Date().toISOString();
    const statusMessage = finalStatusMessage(asrResult);

    await updateRecordingMeeting(input.meetingId, {
      rawTranscript: transcript,
      transcript,
      summary: isTranscribed ? "手机端录音已上传并生成转写。" : "手机端录音已上传，语音识别暂未返回可用转写。",
      conclusions: isTranscribed
        ? ["手机端已完成真实录音上传。", "录音转写已进入妙记详情，可继续生成会议纪要。"]
        : ["手机端已完成真实录音上传。", statusMessage ? `当前录音尚未生成正式转写：${statusMessage}` : "当前录音尚未生成正式转写。"],
      recordingStatus: asrResult.status === "success" ? "transcribed" : "failed",
      recordingStatusMessage: statusMessage || (asrResult.status === "success" ? "云端精修转写已完成。" : "云端精修转写失败。"),
      recordingAsrProvider: "tencent",
      recordingAsrTaskId: "taskId" in asrResult ? String(asrResult.taskId) : undefined,
      recordingFinalizedAt: now
    });
  } catch (error) {
    const fallbackTranscript = usableBrowserTranscript(input.browserTranscript);
    const statusMessage = error instanceof Error ? error.message : "unknown_error";
    await updateRecordingMeeting(input.meetingId, {
      rawTranscript: fallbackTranscript,
      transcript: fallbackTranscript,
      summary: fallbackTranscript ? "手机端录音已上传，云端精修转写失败，已保留实时转写初稿。" : "手机端录音已上传，云端精修转写失败。",
      conclusions: ["手机端已完成真实录音上传。", `云端精修转写失败：${statusMessage}`],
      recordingStatus: "failed",
      recordingStatusMessage: statusMessage,
      recordingAsrProvider: "tencent",
      recordingFinalizedAt: new Date().toISOString()
    });
    throw error;
  }
}

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get("audio");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "missing audio" }, { status: 400 });
    }
    if (!isAudioFile(file)) {
      return NextResponse.json({ error: "unsupported audio type" }, { status: 415 });
    }
    if (file.size > MAX_AUDIO_SIZE_BYTES) {
      return NextResponse.json({ error: "audio too large" }, { status: 413 });
    }

    const now = new Date();
    const durationSeconds = Math.max(0, Number.parseInt(formString(formData, "durationSeconds") || "0", 10) || 0);
    const startedAt = formString(formData, "startedAt") || new Date(now.getTime() - durationSeconds * 1000).toISOString();
    const meetingId = `mobile-recording-${now.getTime()}`;
    const originalName = safeFileName(file.name || `mobile-recording-${now.getTime()}.webm`);
    const storedName = `${meetingId}-${originalName}`;
    const relativePath = path.join("mobile-recordings", dayStamp(now), storedName);
    const storageDir = path.join(process.cwd(), ".local-data", "mobile-recordings", dayStamp(now));
    await mkdir(storageDir, { recursive: true });
    const storedPath = path.join(storageDir, storedName);
    await writeFile(storedPath, Buffer.from(await file.arrayBuffer()));

    const browserTranscriptValue = formData.get("transcript");
    const browserTranscript = typeof browserTranscriptValue === "string" ? browserTranscriptValue.trim() : "";
    const transcript = usableBrowserTranscript(browserTranscript);
    const title = formString(formData, "title") || `手机录音 ${now.toLocaleString("zh-CN", { hour12: false })}`;
    const durationMinutes = durationSeconds > 0 ? Math.max(1, Math.ceil(durationSeconds / 60)) : 0;
    const isTranscribed = transcript.length > 0;
    const meeting: Meeting = {
      id: meetingId,
      title,
      departmentId: currentUser.departmentId,
      type: "AI项目会议",
      hostId: currentUser.id,
      participantIds: [currentUser.id],
      participantCount: 1,
      startTime: startedAt,
      endTime: now.toISOString(),
      durationMinutes,
      rawTranscript: transcript,
      transcript,
      uploadedFileName: originalName,
      sourceBatchId: meetingId,
      sourceFileName: relativePath.replace(/\\/g, "/"),
      sourceExtractedAt: now.toISOString(),
      sourceTemplateName: "mobile-browser-recording",
      sourceTemplateVersion: "1.0",
      summary: isTranscribed ? "手机端录音已上传，正在进行云端精修转写。" : "手机端录音已上传，正在等待云端生成转写。",
      conclusions: isTranscribed
        ? ["已先保存实时转写初稿。", "完整录音正在后台进行云端精修转写。"]
        : ["手机端已完成真实录音上传。", "完整录音正在后台等待云端生成转写。"],
      approvalStatus: "draft",
      status: "draft",
      recordingStatus: "transcribing",
      recordingStatusMessage: isTranscribed ? "已先保存实时转写初稿，云端精修中。" : "录音已保存，云端精修中。",
      recordingAsrProvider: "tencent",
      createdBy: currentUser.id,
      createdAt: now.toISOString()
    };

    if (isDbStateReadEnabled()) {
      await saveRecordedMeetingDb(currentUser, meeting);
    } else {
      await updateLocalStateWith((state) => ({
        ...state,
        meetings: [meeting, ...state.meetings.filter((item) => item.id !== meeting.id)],
        activityLogs: [
          {
            id: `${meeting.id}-recording-uploaded`,
            action: "mobile_recording_uploaded",
            title: "手机端录音已上传",
            detail: `手机端已上传录音文件：${meeting.uploadedFileName}`,
            meetingId: meeting.id,
            actorId: currentUser.id,
            actorName: currentUser.name,
            createdAt: meeting.createdAt
          },
          ...state.activityLogs
        ].slice(0, 300)
      }));
    }

    void finalizeRecordingTranscription({
      meetingId,
      storedPath,
      mimeType: file.type || "application/octet-stream",
      browserTranscript
    }).catch((error) => {
      console.warn("mobile_recording_background_transcription_failed", {
        meetingId,
        message: error instanceof Error ? error.message : "unknown_error"
      });
    });

    return NextResponse.json({
      meeting,
      recording: {
        fileName: originalName,
        storedPath: meeting.sourceFileName,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        durationSeconds,
        transcribed: isTranscribed,
        asr: {
          provider: "tencent",
          status: "transcribing",
          message: "云端精修转写已在后台开始。"
        }
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "mobile recording upload failed",
        detail: error instanceof Error ? error.message : "unknown error"
      },
      { status: 500 }
    );
  }
}
