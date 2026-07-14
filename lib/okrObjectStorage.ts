import { createHash, randomUUID } from "node:crypto";
import type { DbExecutor } from "@/lib/db";
import { getMeetingObjectText, isObjectStorageConfigured, isObjectStorageEnabled, meetingObjectKey, putMeetingObject } from "@/lib/objectStorage";
import { createStorageObjectRecord, findStorageObject } from "@/lib/storageObjectDb";
import type { OkrProject } from "@/lib/okrTypes";

function safeObjectName(value: string) {
  return value.replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_").slice(0, 120) || "okr-project";
}

function projectJson(project: OkrProject) {
  return JSON.stringify(project, null, 2);
}

export async function saveOkrProjectObject(input: {
  project: OkrProject;
  createdBy?: string;
  executor?: DbExecutor;
}) {
  if (!isObjectStorageEnabled() || !isObjectStorageConfigured()) return undefined;

  const body = projectJson(input.project);
  const checksum = createHash("sha256").update(body, "utf8").digest("hex");
  const objectId = `storage-${Date.now()}-${randomUUID()}`;
  const key = meetingObjectKey(["okr", "projects", safeObjectName(input.project.id), "project.json"]);
  const ref = await putMeetingObject({
    key,
    body,
    mimeType: "application/json; charset=utf-8",
    metadata: {
      okr_project_id: input.project.id,
      category: "okr_project",
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
      ownerType: "okr_project",
      ownerId: input.project.id,
      category: "okr_project",
      originalName: `${input.project.id}.json`,
      mimeType: ref.mimeType,
      sizeBytes: ref.sizeBytes,
      checksum,
      createdBy: input.createdBy
    },
    input.executor
  );

  return {
    objectId: record.id,
    objectKey: record.objectKey
  };
}

export async function resolveOkrProjectObject(input: {
  fallbackProject: OkrProject;
  objectId?: string | null;
  objectKey?: string | null;
  executor?: DbExecutor;
}) {
  if (!isObjectStorageEnabled() || !isObjectStorageConfigured()) return input.fallbackProject;
  const objectKey = input.objectKey || (input.objectId ? (await findStorageObject(input.objectId, input.executor))?.objectKey : undefined);
  if (!objectKey) return input.fallbackProject;
  try {
    const text = await getMeetingObjectText(objectKey);
    const parsed = JSON.parse(text) as OkrProject;
    if (!parsed || typeof parsed.id !== "string" || parsed.id !== input.fallbackProject.id) return input.fallbackProject;
    return parsed;
  } catch (error) {
    console.warn("okr_project_object_resolve_failed", {
      projectId: input.fallbackProject.id,
      objectId: input.objectId,
      message: error instanceof Error ? error.message : "unknown_error"
    });
    return input.fallbackProject;
  }
}
