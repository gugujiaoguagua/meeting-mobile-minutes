import { createHash } from "node:crypto";
import { dbQuery, type DbExecutor } from "@/lib/db";
import { findStorageObjectsByOwner } from "@/lib/storageObjectDb";
import type { OkrProject } from "@/lib/okrTypes";
import type { Meeting, StorageObjectAclRecord, StorageObjectAclRole } from "@/lib/types";

export type StorageObjectAclInput = {
  userId?: string | null;
  role: StorageObjectAclRole;
  sourceType: string;
  sourceId: string;
};

type StorageObjectAclRow = {
  id: string;
  objectId: string;
  userId: string;
  role: StorageObjectAclRole;
  sourceType: string;
  sourceId: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

function dateTime(value: string | Date | null | undefined) {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

function aclId(objectId: string, userId: string, role: StorageObjectAclRole) {
  const digest = createHash("sha1").update(`${objectId}:${userId}:${role}`).digest("hex").slice(0, 32);
  return `acl-${digest}`;
}

function toRecord(row: StorageObjectAclRow): StorageObjectAclRecord {
  return {
    id: row.id,
    objectId: row.objectId,
    userId: row.userId,
    role: row.role,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    createdAt: dateTime(row.createdAt),
    updatedAt: dateTime(row.updatedAt)
  };
}

type NormalizedStorageObjectAclInput = {
  userId: string;
  role: StorageObjectAclRole;
  sourceType: string;
  sourceId: string;
};

function normalizedEntries(entries: StorageObjectAclInput[]) {
  const seen = new Set<string>();
  const normalized: NormalizedStorageObjectAclInput[] = [];
  for (const entry of entries) {
    const userId = entry.userId?.trim();
    if (!userId) continue;
    const key = `${userId}:${entry.role}:${entry.sourceType}:${entry.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      userId,
      role: entry.role,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId
    });
  }
  return normalized;
}

export async function replaceStorageObjectAclForObject(
  objectId: string,
  entries: StorageObjectAclInput[],
  executor: DbExecutor = { query: dbQuery }
) {
  await executor.query("delete from storage_object_acl where object_id = $1", [objectId]);
  for (const entry of normalizedEntries(entries)) {
    await executor.query(
      `
        insert into storage_object_acl (
          id, object_id, user_id, role, source_type, source_id, created_at, updated_at
        )
        select $1, $2, $3, $4, $5, $6, now(), now()
        where exists (select 1 from users where id = $3)
        on conflict (object_id, user_id, role) do update set
          source_type = excluded.source_type,
          source_id = excluded.source_id,
          updated_at = now()
      `,
      [aclId(objectId, entry.userId, entry.role), objectId, entry.userId, entry.role, entry.sourceType, entry.sourceId]
    );
  }
}

export async function upsertStorageObjectAclEntries(
  objectId: string,
  entries: StorageObjectAclInput[],
  executor: DbExecutor = { query: dbQuery }
) {
  for (const entry of normalizedEntries(entries)) {
    await executor.query(
      `
        insert into storage_object_acl (
          id, object_id, user_id, role, source_type, source_id, created_at, updated_at
        )
        select $1, $2, $3, $4, $5, $6, now(), now()
        where exists (select 1 from users where id = $3)
        on conflict (object_id, user_id, role) do update set
          source_type = excluded.source_type,
          source_id = excluded.source_id,
          updated_at = now()
      `,
      [aclId(objectId, entry.userId, entry.role), objectId, entry.userId, entry.role, entry.sourceType, entry.sourceId]
    );
  }
}

export async function findStorageObjectAclForUser(userId: string, executor: DbExecutor = { query: dbQuery }) {
  const result = await executor.query<StorageObjectAclRow>(
    `
      select
        id,
        object_id as "objectId",
        user_id as "userId",
        role,
        source_type as "sourceType",
        source_id as "sourceId",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from storage_object_acl
      where user_id = $1
      order by updated_at desc
    `,
    [userId]
  );
  return result.rows.map(toRecord);
}

export async function canUserAccessStorageObject(objectId: string, userId: string, executor: DbExecutor = { query: dbQuery }) {
  const result = await executor.query(
    `
      select 1
      from storage_object_acl
      where object_id = $1 and user_id = $2
      limit 1
    `,
    [objectId, userId]
  );
  return Boolean(result.rowCount);
}

function meetingAclEntries(meeting: Meeting): StorageObjectAclInput[] {
  const entries: StorageObjectAclInput[] = [
    { userId: meeting.createdBy, role: "creator", sourceType: "meeting", sourceId: meeting.id },
    { userId: meeting.hostId, role: "owner", sourceType: "meeting", sourceId: meeting.id },
    { userId: meeting.approvedBy, role: "approver", sourceType: "meeting", sourceId: meeting.id }
  ];
  for (const userId of meeting.participantIds ?? []) {
    entries.push({ userId, role: "participant", sourceType: "meeting_participant", sourceId: meeting.id });
  }
  for (const task of meeting.tasks ?? []) {
    entries.push({ userId: task.ownerId, role: "assignee", sourceType: "task", sourceId: task.id });
    entries.push({ userId: task.reviewerId, role: "reviewer", sourceType: "task", sourceId: task.id });
  }
  return entries;
}

export async function syncMeetingStorageObjectAcl(meeting: Meeting, executor: DbExecutor = { query: dbQuery }) {
  const objects = await findStorageObjectsByOwner("meeting", meeting.id, undefined, executor);
  const entries = meetingAclEntries(meeting);
  for (const object of objects) {
    await replaceStorageObjectAclForObject(object.id, entries, executor);
  }
}

function okrAclEntries(project: OkrProject): StorageObjectAclInput[] {
  const entries: StorageObjectAclInput[] = [
    { userId: project.ownerId, role: "owner", sourceType: "okr_project", sourceId: project.id }
  ];
  for (const kr of project.krs ?? []) {
    entries.push({ userId: kr.ownerId, role: "owner", sourceType: "okr_kr", sourceId: kr.id });
    entries.push({ userId: kr.reviewerId, role: "reviewer", sourceType: "okr_kr", sourceId: kr.id });
  }
  for (const task of project.pdcaTasks ?? []) {
    entries.push({ userId: task.ownerId, role: "assignee", sourceType: "okr_pdca_task", sourceId: task.id });
    entries.push({ userId: task.reviewerId, role: "reviewer", sourceType: "okr_pdca_task", sourceId: task.id });
  }
  return entries;
}

export async function syncOkrProjectStorageObjectAcl(project: OkrProject, executor: DbExecutor = { query: dbQuery }) {
  const objects = await findStorageObjectsByOwner("okr_project", project.id, undefined, executor);
  const entries = okrAclEntries(project);
  for (const object of objects) {
    await replaceStorageObjectAclForObject(object.id, entries, executor);
  }
}
