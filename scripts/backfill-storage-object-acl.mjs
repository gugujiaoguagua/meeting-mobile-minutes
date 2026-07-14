import { createHash } from "node:crypto";
import { connectPg, parseArgs } from "./migration-utils.mjs";

const args = parseArgs();
const apply = args.apply === true;
const client = await connectPg(args);

function aclId(objectId, userId, role) {
  return `acl-${createHash("sha1").update(`${objectId}:${userId}:${role}`).digest("hex").slice(0, 32)}`;
}

function addEntry(entries, userId, role, sourceType, sourceId) {
  if (!userId) return;
  entries.push({ userId, role, sourceType, sourceId });
}

function dedupe(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.userId}:${entry.role}:${entry.sourceType}:${entry.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function upsertAcl(objectId, entries) {
  let inserted = 0;
  for (const entry of dedupe(entries)) {
    const result = await client.query(
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
        returning id
      `,
      [aclId(objectId, entry.userId, entry.role), objectId, entry.userId, entry.role, entry.sourceType, entry.sourceId]
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

async function meetingEntries(meetingId) {
  const [meeting, participants, tasks] = await Promise.all([
    client.query(
      `
        select id, created_by, host_id, approved_by
        from meetings
        where id = $1
      `,
      [meetingId]
    ),
    client.query("select user_id from meeting_participants where meeting_id = $1", [meetingId]),
    client.query("select id, owner_id, reviewer_id from tasks where meeting_id = $1", [meetingId])
  ]);
  const row = meeting.rows[0];
  if (!row) return [];
  const entries = [];
  addEntry(entries, row.created_by, "creator", "meeting", meetingId);
  addEntry(entries, row.host_id, "owner", "meeting", meetingId);
  addEntry(entries, row.approved_by, "approver", "meeting", meetingId);
  for (const item of participants.rows) addEntry(entries, item.user_id, "participant", "meeting_participant", meetingId);
  for (const task of tasks.rows) {
    addEntry(entries, task.owner_id, "assignee", "task", task.id);
    addEntry(entries, task.reviewer_id, "reviewer", "task", task.id);
  }
  return entries;
}

async function okrEntries(projectId) {
  const [project, krs, tasks] = await Promise.all([
    client.query("select id, owner_id from okr_projects where id = $1", [projectId]),
    client.query("select id, owner_id, reviewer_id from okr_krs where project_id = $1", [projectId]),
    client.query("select id, owner_id, reviewer_id from okr_pdca_tasks where project_id = $1", [projectId])
  ]);
  const row = project.rows[0];
  if (!row) return [];
  const entries = [];
  addEntry(entries, row.owner_id, "owner", "okr_project", projectId);
  for (const kr of krs.rows) {
    addEntry(entries, kr.owner_id, "owner", "okr_kr", kr.id);
    addEntry(entries, kr.reviewer_id, "reviewer", "okr_kr", kr.id);
  }
  for (const task of tasks.rows) {
    addEntry(entries, task.owner_id, "assignee", "okr_pdca_task", task.id);
    addEntry(entries, task.reviewer_id, "reviewer", "okr_pdca_task", task.id);
  }
  return entries;
}

try {
  const objects = await client.query(
    `
      select id, owner_type, owner_id, category
      from storage_objects
      where deleted_at is null
      order by owner_type, owner_id, category
    `
  );

  let objectCount = 0;
  let aclCount = 0;
  for (const object of objects.rows) {
    let entries = [];
    if (object.owner_type === "meeting") entries = await meetingEntries(object.owner_id);
    if (object.owner_type === "okr_project") entries = await okrEntries(object.owner_id);
    if (!entries.length) continue;
    objectCount += 1;
    if (apply) {
      aclCount += await upsertAcl(object.id, entries);
    } else {
      aclCount += dedupe(entries).length;
    }
  }

  console.log(`storageObjectAclBackfillMode=${apply ? "apply" : "dry-run"}`);
  console.log(`storageObjectsMatched=${objectCount}`);
  console.log(`aclRows${apply ? "Upserted" : "WouldUpsert"}=${aclCount}`);
} finally {
  await client.end();
}
