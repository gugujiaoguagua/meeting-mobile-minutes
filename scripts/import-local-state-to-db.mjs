import { connectPg, normalizeExportPath, parseArgs, readJson, readMigrationSql } from "./migration-utils.mjs";

const args = parseArgs();
const exportPath = args.export ? normalizeExportPath(args.export) : undefined;
if (!exportPath) throw new Error("Missing --export <path-to-export-json>");

const exportPackage = await readJson(exportPath);
const client = await connectPg(args);

const tableSpecs = [
  ["departments", "departments", ["id"]],
  ["users", "users", ["id"]],
  ["meetings", "meetings", ["id"]],
  ["meetingParticipants", "meeting_participants", ["meeting_id", "user_id"]],
  ["meetingFiles", "meeting_files", ["id"]],
  ["meetingMinutes", "meeting_minutes", ["id"]],
  ["meetingDecisions", "meeting_decisions", ["id"]],
  ["tasks", "tasks", ["id"]],
  ["taskProgressEntries", "task_progress_entries", ["id"]],
  ["taskApprovalLogs", "task_approval_logs", ["id"]],
  ["taskReviewLogs", "task_review_logs", ["id"]],
  ["notifications", "notifications", ["id"]],
  ["notificationReads", "notification_reads", ["user_id", "notification_id"]],
  ["activityLogs", "activity_logs", ["id"]],
  ["userPreferences", "user_preferences", ["user_id"]]
];

const truncateOrder = [
  "notification_reads",
  "user_preferences",
  "notifications",
  "task_review_logs",
  "task_approval_logs",
  "task_progress_entries",
  "activity_logs",
  "tasks",
  "meeting_decisions",
  "meeting_minutes",
  "meeting_files",
  "meeting_participants",
  "meetings",
  "users",
  "departments"
];

function toDbValue(value) {
  if (Array.isArray(value) || (value && typeof value === "object")) return JSON.stringify(value);
  return value === undefined ? null : value;
}

async function upsertRows(table, rows, conflictColumns, batchSize = 250) {
  if (!rows.length) return 0;
  const columns = Object.keys(rows[0]);
  const updateColumns = columns.filter((column) => !conflictColumns.includes(column));
  let imported = 0;

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = [];
    const placeholders = batch.map((row, rowIndex) => {
      const rowPlaceholders = columns.map((column, columnIndex) => {
        values.push(toDbValue(row[column]));
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });
      return `(${rowPlaceholders.join(", ")})`;
    });
    const conflict = conflictColumns.map((column) => `"${column}"`).join(", ");
    const updateClause = updateColumns.length
      ? `do update set ${updateColumns.map((column) => `"${column}" = excluded."${column}"`).join(", ")}`
      : "do nothing";
    const sql = `
      insert into "${table}" (${columns.map((column) => `"${column}"`).join(", ")})
      values ${placeholders.join(", ")}
      on conflict (${conflict}) ${updateClause}
    `;
    await client.query(sql, values);
    imported += batch.length;
  }
  return imported;
}

try {
  if (!args["skip-schema"]) {
    await client.query(await readMigrationSql(args.schema));
  }

  await client.query("begin");
  if (args.truncate) {
    for (const table of truncateOrder) {
      await client.query(`delete from "${table}"`);
    }
  }

  const imported = {};
  for (const [exportKey, table, conflictColumns] of tableSpecs) {
    imported[table] = await upsertRows(table, exportPackage.data?.[exportKey] ?? [], conflictColumns);
  }

  await client.query("commit");
  console.log("Imported export package into PostgreSQL.");
  console.log(JSON.stringify({ exportPath, imported }, null, 2));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end();
}
