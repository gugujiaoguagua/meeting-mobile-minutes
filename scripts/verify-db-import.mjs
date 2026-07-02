import { connectPg, normalizeExportPath, parseArgs, readJson } from "./migration-utils.mjs";

const args = parseArgs();
const exportPath = args.export ? normalizeExportPath(args.export) : undefined;
if (!exportPath) throw new Error("Missing --export <path-to-export-json>");

const exportPackage = await readJson(exportPath);
const client = await connectPg(args);
const allowExtra = Boolean(args["allow-extra"]);

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

async function countTable(table) {
  const result = await client.query(`select count(*)::int as count from "${table}"`);
  return result.rows[0].count;
}

async function verifyStatuses() {
  const failures = [];
  for (const meeting of exportPackage.data.meetings ?? []) {
    const result = await client.query("select approval_status, status from meetings where id = $1", [meeting.id]);
    if (!result.rowCount) {
      failures.push({ type: "missing_meeting", id: meeting.id });
      continue;
    }
    const row = result.rows[0];
    if (row.approval_status !== meeting.approval_status || row.status !== meeting.status) {
      failures.push({ type: "meeting_status_mismatch", id: meeting.id, expected: { approval_status: meeting.approval_status, status: meeting.status }, actual: row });
    }
  }
  for (const task of exportPackage.data.tasks ?? []) {
    const result = await client.query("select approval_status, status from tasks where id = $1", [task.id]);
    if (!result.rowCount) {
      failures.push({ type: "missing_task", id: task.id });
      continue;
    }
    const row = result.rows[0];
    if (row.approval_status !== task.approval_status || row.status !== task.status) {
      failures.push({ type: "task_status_mismatch", id: task.id, expected: { approval_status: task.approval_status, status: task.status }, actual: row });
    }
  }
  return failures;
}

try {
  const counts = [];
  for (const [exportKey, table] of countSpecs) {
    const expected = exportPackage.counts?.[exportKey] ?? 0;
    const actual = await countTable(table);
    const pass = allowExtra ? actual >= expected : actual === expected;
    counts.push({ table, expected, actual, pass });
  }
  const statusFailures = await verifyStatuses();
  const failedCounts = counts.filter((item) => !item.pass);
  const ok = failedCounts.length === 0 && statusFailures.length === 0;
  console.log(JSON.stringify({ ok, counts, statusFailures }, null, 2));
  if (!ok) process.exitCode = 1;
} finally {
  await client.end();
}
