import { createHash, randomUUID } from "node:crypto";
import type { DbExecutor } from "@/lib/db";
import { getMeetingObjectText, getObjectStoragePublicConfig, isObjectStorageConfigured, isObjectStorageEnabled, meetingObjectKey, putMeetingObject } from "@/lib/objectStorage";
import { upsertStorageObjectAclEntries } from "@/lib/storageObjectAcl";
import { createStorageObjectRecord, findStorageObject } from "@/lib/storageObjectDb";

export type MeetingLargeContentCategory = "raw_transcript" | "transcript" | "minute_markdown" | "ai_draft_request" | "ai_draft_result";

const PREVIEW_LENGTH = 1800;

function categoryPath(category: MeetingLargeContentCategory) {
  switch (category) {
    case "raw_transcript":
      return ["meetings", "raw-transcripts"];
    case "transcript":
      return ["meetings", "transcripts"];
    case "minute_markdown":
      return ["meetings", "minutes"];
    case "ai_draft_request":
      return ["meetings", "ai-drafts", "requests"];
    case "ai_draft_result":
      return ["meetings", "ai-drafts", "results"];
  }
}

function safeObjectName(value: string) {
  return value.replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_").slice(0, 120) || "content";
}

function extensionFor(category: MeetingLargeContentCategory) {
  if (category === "minute_markdown") return "md";
  if (category === "ai_draft_request" || category === "ai_draft_result") return "json";
  return "txt";
}

function mimeTypeFor(category: MeetingLargeContentCategory, fallback?: string) {
  if (fallback) return fallback;
  if (category === "minute_markdown") return "text/markdown; charset=utf-8";
  if (category === "ai_draft_request" || category === "ai_draft_result") return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

export function largeContentPreview(text: string) {
  return text.length > PREVIEW_LENGTH ? text.slice(0, PREVIEW_LENGTH) : text;
}

export async function saveLargeMeetingText(input: {
  meetingId: string;
  category: MeetingLargeContentCategory;
  text: string | undefined | null;
  createdBy?: string;
  mimeType?: string;
  executor?: DbExecutor;
}) {
  const text = input.text ?? "";
  if (!text || !isObjectStorageEnabled() || !isObjectStorageConfigured()) {
    return { preview: text };
  }
  const preview = largeContentPreview(text);

  const publicConfig = getObjectStoragePublicConfig();
  const checksum = createHash("sha256").update(text, "utf8").digest("hex");
  const objectId = `storage-${Date.now()}-${randomUUID()}`;
  const key = meetingObjectKey([
    ...categoryPath(input.category),
    `${safeObjectName(input.meetingId)}-${objectId}.${extensionFor(input.category)}`
  ]);
  const ref = await putMeetingObject({
    key,
    body: text,
    mimeType: mimeTypeFor(input.category, input.mimeType),
    metadata: {
      meeting_id: input.meetingId,
      category: input.category,
      checksum
    }
  });

  const record = await createStorageObjectRecord(
    {
      id: objectId,
      provider: "oss",
      bucket: ref.bucket,
      region: ref.region,
      endpoint: ref.endpoint,
      objectKey: ref.key,
      ownerType: "meeting",
      ownerId: input.meetingId,
      category: input.category,
      originalName: `${input.meetingId}-${input.category}.${extensionFor(input.category)}`,
      mimeType: ref.mimeType,
      sizeBytes: ref.sizeBytes,
      checksum,
      createdBy: input.createdBy
    },
    input.executor
  );
  await upsertStorageObjectAclEntries(
    record.id,
    [{ userId: input.createdBy, role: "creator", sourceType: "meeting", sourceId: input.meetingId }],
    input.executor
  );

  return {
    preview,
    objectId: record.id,
    objectKey: key,
    bucket: publicConfig.bucket,
    prefix: publicConfig.prefix
  };
}

export async function resolveLargeMeetingText(input: {
  inlineText?: string | null;
  objectId?: string | null;
  objectKey?: string | null;
  executor?: DbExecutor;
}) {
  const inlineText = input.inlineText ?? "";
  const objectKey = input.objectKey || (input.objectId ? (await findStorageObject(input.objectId, input.executor))?.objectKey : undefined);
  if (!objectKey || !isObjectStorageEnabled() || !isObjectStorageConfigured()) return inlineText;
  try {
    return await getMeetingObjectText(objectKey);
  } catch (error) {
    console.warn("meeting_large_content_resolve_failed", {
      objectId: input.objectId,
      message: error instanceof Error ? error.message : "unknown_error"
    });
    return inlineText;
  }
}
