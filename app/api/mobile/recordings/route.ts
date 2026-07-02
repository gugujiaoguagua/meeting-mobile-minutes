import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { saveRecordedMeetingDb } from "@/lib/dbWriteStore";
import { updateLocalStateWith } from "@/lib/localStateStore";
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

function normalizeTranscript(value: FormDataEntryValue | null, fileName: string, durationSeconds: number) {
  const transcript = typeof value === "string" ? value.trim() : "";
  if (transcript.length >= 20) return transcript;
  const durationText = durationSeconds > 0 ? `${durationSeconds} 秒` : "未计时";
  return [
    `系统：已保存手机端真实录音文件 ${fileName}，录音时长 ${durationText}。`,
    "系统：当前测试环境尚未配置语音识别服务，因此这条妙记已进入待转写状态。",
    "系统：接入 ASR 后，后端将在此处返回真实转写文本。"
  ].join("\n");
}

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
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
    await writeFile(path.join(storageDir, storedName), Buffer.from(await file.arrayBuffer()));

    const transcript = normalizeTranscript(formData.get("transcript"), originalName, durationSeconds);
    const title = formString(formData, "title") || `手机录音 ${now.toLocaleString("zh-CN", { hour12: false })}`;
    const durationMinutes = durationSeconds > 0 ? Math.max(1, Math.ceil(durationSeconds / 60)) : 0;
    const isWaitingForAsr = transcript.includes("尚未配置语音识别服务");
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
      summary: isWaitingForAsr ? "手机端录音已上传，等待语音识别转写。" : "手机端录音已上传并生成转写。",
      conclusions: isWaitingForAsr
        ? ["手机端已完成真实录音上传。", "当前测试环境尚未配置语音识别服务，需接入 ASR 后生成正式转写。"]
        : ["手机端已完成真实录音上传。", "录音转写已进入妙记详情，可继续生成会议纪要。"],
      approvalStatus: "draft",
      status: "draft",
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

    return NextResponse.json({
      meeting,
      recording: {
        fileName: originalName,
        storedPath: meeting.sourceFileName,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        durationSeconds,
        transcribed: !isWaitingForAsr
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
