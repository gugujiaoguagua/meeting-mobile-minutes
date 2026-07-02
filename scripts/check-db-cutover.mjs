import fs from "node:fs/promises";
import path from "node:path";
import { connectPg, defaultExportDir, getDatabaseUrl, normalizeExportPath, parseArgs, readJson } from "./migration-utils.mjs";

const args = parseArgs();

const countSpecs = [
  ["departments", "departments"],
  ["users", "users"],
  ["meetings", "meetings"],
  ["meetingParticipants", "meeting_participants"],
  ["meetingFiles", "meeting_files"],
  ["meetingMinutes", "meeting_minutes"],
  ["meetingDecisions", "meeting_decisions"],
  ["tasks", "tasks"],
  ["taskProgressEntries", "task_progress_entries"],
  ["taskApprovalLogs", "task_approval_logs"],
  ["taskReviewLogs", "task_review_logs"],
  ["notifications", "notifications"],
  ["notificationReads", "notification_reads"],
  ["activityLogs", "activity_logs"],
  ["userPreferences", "user_preferences"]
];

async function latestExportPath() {
  const entries = await fs.readdir(defaultExportDir, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith("meeting-loop-state-export-") || !entry.name.endsWith(".json")) continue;
    const fullPath = path.join(defaultExportDir, entry.name);
    candidates.push({ fullPath, stat: await fs.stat(fullPath) });
  }
  candidates.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return candidates[0]?.fullPath;
}

async function countTable(client, table) {
  const result = await client.query(`select count(*)::int as count from "${table}"`);
  return result.rows[0].count;
}

async function verifyStatuses(client, exportPackage) {
  const failures = [];
  for (const meeting of exportPackage.data?.meetings ?? []) {
    const result = await client.query("select approval_status, status from meetings where id = $1", [meeting.id]);
    if (!result.rowCount) {
      failures.push({ type: "missing_meeting", id: meeting.id });
      continue;
    }
    const actual = result.rows[0];
    if (actual.approval_status !== meeting.approval_status || actual.status !== meeting.status) {
      failures.push({ type: "meeting_status_mismatch", id: meeting.id, expected: { approval_status: meeting.approval_status, status: meeting.status }, actual });
    }
  }
  for (const task of exportPackage.data?.tasks ?? []) {
    const result = await client.query("select approval_status, status from tasks where id = $1", [task.id]);
    if (!result.rowCount) {
      failures.push({ type: "missing_task", id: task.id });
      continue;
    }
    const actual = result.rows[0];
    if (actual.approval_status !== task.approval_status || actual.status !== task.status) {
      failures.push({ type: "task_status_mismatch", id: task.id, expected: { approval_status: task.approval_status, status: task.status }, actual });
    }
  }
  return failures;
}

const exportPath = args.export ? normalizeExportPath(args.export) : await latestExportPath();
if (!exportPath) {
  throw new Error("No export package found. Run: corepack pnpm db:export");
}

const exportPackage = await readJson(exportPath);
const databaseUrl = getDatabaseUrl(args);
if (!databaseUrl) {
  throw new Error("DATABASE_URL or POSTGRES_URL is required for cutover check.");
}

const client = await connectPg(args);
try {
  await client.query("select 1");
  const counts = [];
  for (const [exportKey, table] of countSpecs) {
    const expected = exportPackage.counts?.[exportKey] ?? 0;
    const actual = await countTable(client, table);
    counts.push({ table, expected, actual, pass: actual === expected });
  }
  const statusFailures = await verifyStatuses(client, exportPackage);
  const failedCounts = counts.filter((item) => !item.pass);
  const runtimeStore = process.env.MEETING_STATE_STORE || (process.env.MEETING_USE_DB_STATE === "true" ? "db" : "json");
  const runtimeDbEnabled = runtimeStore === "db" || runtimeStore === "postgres" || process.env.MEETING_USE_DB_STATE === "true";
  const ok = failedCounts.length === 0 && statusFailures.length === 0 && (!args["require-runtime-db"] || runtimeDbEnabled);
  console.log(
    JSON.stringify(
      {
        ok,
        exportPath,
        databaseConnected: true,
        runtimeDbEnabled,
        counts,
        statusFailures
      },
      null,
      2
    )
  );
  if (!ok) process.exitCode = 1;
} finally {
  await client.end();
}
