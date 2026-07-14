import { dbQuery, type DbExecutor } from "@/lib/db";
import type { StorageObjectRecord, StorageProvider } from "@/lib/types";

type StorageObjectRow = {
  id: string;
  provider: StorageProvider;
  bucket: string;
  region: string;
  endpoint: string;
  objectKey: string;
  ownerType: string;
  ownerId: string;
  category: string;
  originalName?: string | null;
  mimeType?: string | null;
  sizeBytes?: string | number | null;
  checksum?: string | null;
  createdBy?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt?: string | Date | null;
};

export type StorageObjectInput = {
  id: string;
  provider: StorageProvider;
  bucket: string;
  region: string;
  endpoint: string;
  objectKey: string;
  ownerType: string;
  ownerId: string;
  category: string;
  originalName?: string;
  mimeType?: string;
  sizeBytes?: number;
  checksum?: string;
  createdBy?: string;
};

function dateTime(value: string | Date | null | undefined) {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

function numberValue(value: string | number | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value !== "") return Number(value);
  return undefined;
}

function toRecord(row: StorageObjectRow): StorageObjectRecord {
  return {
    id: row.id,
    provider: row.provider,
    bucket: row.bucket,
    region: row.region,
    endpoint: row.endpoint,
    objectKey: row.objectKey,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    category: row.category,
    originalName: row.originalName || undefined,
    mimeType: row.mimeType || undefined,
    sizeBytes: numberValue(row.sizeBytes),
    checksum: row.checksum || undefined,
    createdBy: row.createdBy || undefined,
    createdAt: dateTime(row.createdAt),
    updatedAt: dateTime(row.updatedAt),
    deletedAt: dateTime(row.deletedAt) || undefined
  };
}

function selectStorageObjectSql() {
  return `
    select
      id,
      provider,
      bucket,
      region,
      endpoint,
      object_key as "objectKey",
      owner_type as "ownerType",
      owner_id as "ownerId",
      category,
      original_name as "originalName",
      mime_type as "mimeType",
      size_bytes as "sizeBytes",
      checksum,
      created_by as "createdBy",
      created_at as "createdAt",
      updated_at as "updatedAt",
      deleted_at as "deletedAt"
    from storage_objects
  `;
}

export async function createStorageObjectRecord(input: StorageObjectInput, executor: DbExecutor = { query: dbQuery }) {
  const result = await executor.query<StorageObjectRow>(
    `
      insert into storage_objects (
        id, provider, bucket, region, endpoint, object_key, owner_type, owner_id,
        category, original_name, mime_type, size_bytes, checksum, created_by,
        created_at, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now(), now())
      on conflict (provider, bucket, object_key) do update set
        owner_type = excluded.owner_type,
        owner_id = excluded.owner_id,
        category = excluded.category,
        original_name = excluded.original_name,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        checksum = excluded.checksum,
        created_by = excluded.created_by,
        updated_at = now(),
        deleted_at = null
      returning
        id,
        provider,
        bucket,
        region,
        endpoint,
        object_key as "objectKey",
        owner_type as "ownerType",
        owner_id as "ownerId",
        category,
        original_name as "originalName",
        mime_type as "mimeType",
        size_bytes as "sizeBytes",
        checksum,
        created_by as "createdBy",
        created_at as "createdAt",
        updated_at as "updatedAt",
        deleted_at as "deletedAt"
    `,
    [
      input.id,
      input.provider,
      input.bucket,
      input.region,
      input.endpoint,
      input.objectKey,
      input.ownerType,
      input.ownerId,
      input.category,
      input.originalName ?? null,
      input.mimeType ?? null,
      input.sizeBytes ?? null,
      input.checksum ?? null,
      input.createdBy ?? null
    ]
  );
  return toRecord(result.rows[0]);
}

export async function findStorageObject(id: string, executor: DbExecutor = { query: dbQuery }) {
  const result = await executor.query<StorageObjectRow>(`${selectStorageObjectSql()} where id = $1 and deleted_at is null`, [id]);
  return result.rows[0] ? toRecord(result.rows[0]) : undefined;
}

export async function findStorageObjectsByIds(ids: string[], executor: DbExecutor = { query: dbQuery }) {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (!uniqueIds.length) return [];
  const result = await executor.query<StorageObjectRow>(
    `${selectStorageObjectSql()}
     where id = any($1::text[]) and deleted_at is null
     order by created_at desc`,
    [uniqueIds]
  );
  return result.rows.map(toRecord);
}

export async function findStorageObjectsByOwner(ownerType: string, ownerId: string, category?: string, executor: DbExecutor = { query: dbQuery }) {
  const result = await executor.query<StorageObjectRow>(
    `${selectStorageObjectSql()}
     where owner_type = $1 and owner_id = $2 and deleted_at is null
       and ($3::text is null or category = $3)
     order by created_at desc`,
    [ownerType, ownerId, category ?? null]
  );
  return result.rows.map(toRecord);
}

export async function softDeleteStorageObject(id: string, executor: DbExecutor = { query: dbQuery }) {
  await executor.query(`update storage_objects set deleted_at = now(), updated_at = now() where id = $1`, [id]);
}
