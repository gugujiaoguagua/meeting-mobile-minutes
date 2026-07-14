import { createHash, randomUUID } from "node:crypto";
import { getPresidentUserId } from "@/lib/permission";
import { isObjectStorageConfigured, isObjectStorageEnabled, meetingObjectKey, putMeetingObject } from "@/lib/objectStorage";
import { upsertStorageObjectAclEntries, type StorageObjectAclInput } from "@/lib/storageObjectAcl";
import { createStorageObjectRecord } from "@/lib/storageObjectDb";
import type { StorageObjectRecord, User } from "@/lib/types";

function safeObjectName(value: string) {
  return value.replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_").slice(0, 120) || "file";
}

function extensionFromName(fileName: string) {
  const match = fileName.match(/\.([a-z0-9]{1,12})$/i);
  return match ? match[1].toLowerCase() : "bin";
}

function normalizeOwnerType(value?: string | null) {
  const ownerType = value?.trim();
  return ownerType === "meeting" || ownerType === "okr_project" ? ownerType : "import_file";
}

function normalizeOwnerId(ownerType: string, ownerId: string | undefined, objectId: string) {
  const cleanOwnerId = ownerId?.trim();
  if (cleanOwnerId) return cleanOwnerId;
  return ownerType === "import_file" ? objectId : "unassigned";
}

export async function saveImportedFileObject(input: {
  fileName: string;
  mimeType?: string;
  body: Buffer;
  currentUser: User;
  ownerType?: string | null;
  ownerId?: string | null;
}) {
  if (!isObjectStorageEnabled() || !isObjectStorageConfigured()) return undefined;

  const objectId = `storage-${Date.now()}-${randomUUID()}`;
  const ownerType = normalizeOwnerType(input.ownerType);
  const ownerId = normalizeOwnerId(ownerType, input.ownerId ?? undefined, objectId);
  const checksum = createHash("sha256").update(input.body).digest("hex");
  const extension = extensionFromName(input.fileName);
  const key = meetingObjectKey(["imports", ownerType, safeObjectName(ownerId), `${objectId}-${safeObjectName(input.fileName)}.${extension}`]);
  const ref = await putMeetingObject({
    key,
    body: input.body,
    mimeType: input.mimeType || "application/octet-stream"
  });

  const record = await createStorageObjectRecord({
    id: objectId,
    provider: "oss",
    bucket: ref.bucket,
    region: ref.region,
    endpoint: ref.endpoint,
    objectKey: ref.key,
    ownerType,
    ownerId,
    category: "import_file",
    originalName: input.fileName,
    mimeType: ref.mimeType,
    sizeBytes: ref.sizeBytes,
    checksum,
    createdBy: input.currentUser.id
  });

  const presidentId = getPresidentUserId();
  const aclEntries: StorageObjectAclInput[] = [{ userId: input.currentUser.id, role: "creator", sourceType: ownerType, sourceId: ownerId }];
  if (presidentId !== input.currentUser.id) {
    aclEntries.push({ userId: presidentId, role: "viewer", sourceType: ownerType, sourceId: ownerId });
  }
  await upsertStorageObjectAclEntries(record.id, aclEntries);

  return record satisfies StorageObjectRecord;
}
