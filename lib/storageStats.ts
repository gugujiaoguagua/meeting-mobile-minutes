import { dbQuery, type DbExecutor } from "@/lib/db";

export type StorageStatsRow = {
  ownerType: string;
  category: string;
  objectCount: number;
  totalSizeBytes: number;
  aclObjectCount: number;
  objectsWithoutAcl: number;
  latestUpdatedAt: string;
};

type StorageStatsDbRow = {
  ownerType: string;
  category: string;
  objectCount: string | number;
  totalSizeBytes: string | number | null;
  aclObjectCount: string | number;
  objectsWithoutAcl: string | number;
  latestUpdatedAt: string | Date | null;
};

function numberValue(value: string | number | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value !== "") return Number(value);
  return 0;
}

function dateTime(value: string | Date | null | undefined) {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

export async function readStorageStats(executor: DbExecutor = { query: dbQuery }) {
  const result = await executor.query<StorageStatsDbRow>(
    `
      select
        so.owner_type as "ownerType",
        so.category,
        count(*) as "objectCount",
        coalesce(sum(so.size_bytes), 0) as "totalSizeBytes",
        count(*) filter (where acl.object_id is not null) as "aclObjectCount",
        count(*) filter (where acl.object_id is null) as "objectsWithoutAcl",
        max(so.updated_at) as "latestUpdatedAt"
      from storage_objects so
      left join (
        select distinct object_id
        from storage_object_acl
      ) acl on acl.object_id = so.id
      where so.deleted_at is null
      group by so.owner_type, so.category
      order by so.owner_type, so.category
    `
  );
  return result.rows.map((row) => ({
    ownerType: row.ownerType,
    category: row.category,
    objectCount: numberValue(row.objectCount),
    totalSizeBytes: numberValue(row.totalSizeBytes),
    aclObjectCount: numberValue(row.aclObjectCount),
    objectsWithoutAcl: numberValue(row.objectsWithoutAcl),
    latestUpdatedAt: dateTime(row.latestUpdatedAt)
  }));
}

export async function readStorageTotals(executor: DbExecutor = { query: dbQuery }) {
  const result = await executor.query<{
    objectCount: string | number;
    totalSizeBytes: string | number | null;
    objectsWithoutAcl: string | number;
  }>(
    `
      select
        count(*) as "objectCount",
        coalesce(sum(so.size_bytes), 0) as "totalSizeBytes",
        count(*) filter (where not exists (
          select 1 from storage_object_acl soa where soa.object_id = so.id
        )) as "objectsWithoutAcl"
      from storage_objects so
      where so.deleted_at is null
    `
  );
  const row = result.rows[0];
  return {
    objectCount: numberValue(row?.objectCount),
    totalSizeBytes: numberValue(row?.totalSizeBytes),
    objectsWithoutAcl: numberValue(row?.objectsWithoutAcl)
  };
}
