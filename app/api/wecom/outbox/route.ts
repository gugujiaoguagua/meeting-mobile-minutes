import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { dbQuery, isDbStateReadEnabled } from "@/lib/db";
import { getMeetingPublicBaseUrl } from "@/lib/wecomConfig";
import { buildWecomEntryUrl, createSignedDeepLink } from "@/lib/wecomDeepLink";
import { sendWecomTextcard, type WecomSendResult } from "@/lib/wecomMessage";
import { markWecomOutboxAttempt, markWecomOutboxResult } from "@/lib/wecomOutbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedStatuses = new Set(["pending", "sent", "failed", "skipped"]);
const retryableStatuses = new Set(["pending", "failed", "skipped"]);
const allowedEventTypes = new Set([
  "task_review_submitted",
  "task_review_confirmed",
  "task_review_rejected",
  "meeting_approval_submitted",
  "task_approval_approved",
  "task_approval_rejected",
  "meeting_approval_rejected",
  "okr_project_created",
  "okr_pdca_review_submitted",
  "okr_pdca_review_confirmed",
  "okr_pdca_review_rejected",
  "okr_pdca_due_date_changed"
]);

function clampLimit(value: string | null) {
  const parsed = Number.parseInt(value || "50", 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 200);
}

type OutboxItemRow = {
  id: string;
  eventType: string;
  sourceType: string;
  sourceId: string;
  recipientUserId?: string;
  recipientName?: string;
  touser: string;
  agentid: number;
  title: string;
  description?: string;
  url?: string;
  btntxt?: string;
  status: "pending" | "sent" | "failed" | "skipped";
  errcode?: number;
  errmsg?: string;
  invaliduser?: string;
  msgid?: string;
  attemptCount: number;
  lastAttemptAt?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
};

const outboxSelectSql = `
  select
    id,
    event_type as "eventType",
    source_type as "sourceType",
    source_id as "sourceId",
    recipient_user_id as "recipientUserId",
    recipient_name as "recipientName",
    touser,
    agentid,
    title,
    description,
    url,
    btntxt,
    status,
    errcode,
    errmsg,
    invaliduser,
    msgid,
    attempt_count as "attemptCount",
    last_attempt_at as "lastAttemptAt",
    sent_at as "sentAt",
    created_at as "createdAt",
    updated_at as "updatedAt"
  from wecom_message_outbox
`;

function isRedactedUrl(url?: string) {
  return Boolean(url?.includes("[redacted]") || url?.includes("token=%5Bredacted%5D"));
}

function buildFallbackRetryUrl(row: OutboxItemRow) {
  const recipientUserId = row.recipientUserId || "";
  if (recipientUserId && row.sourceType === "task") {
    return buildWecomEntryUrl({ reviewerUserId: recipientUserId, taskId: row.sourceId });
  }
  if (recipientUserId && row.sourceType === "okr_pdca_task") {
    return buildWecomEntryUrl({ reviewerUserId: recipientUserId, taskId: `okr-task-${row.sourceId}` });
  }
  if (recipientUserId) {
    const signedToken = createSignedDeepLink({ userId: recipientUserId, page: "my-tasks" });
    if (signedToken) return `${getMeetingPublicBaseUrl()}/api/wecom/deeplink?token=${encodeURIComponent(signedToken)}`;
  }
  return `${getMeetingPublicBaseUrl()}/?page=my-tasks`;
}

function resolveRetryUrl(row: OutboxItemRow) {
  if (row.url && !isRedactedUrl(row.url)) return row.url;
  return buildFallbackRetryUrl(row);
}

async function getOutboxItem(id: string) {
  const result = await dbQuery<OutboxItemRow>(`${outboxSelectSql} where id = $1`, [id]);
  return result.rows[0];
}

export async function GET(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (currentUser.role !== "总裁") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (!isDbStateReadEnabled()) {
    return NextResponse.json({ items: [], summary: [], total: 0 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "";
  const eventType = url.searchParams.get("eventType") || "";
  const q = (url.searchParams.get("q") || "").trim();
  const limit = clampLimit(url.searchParams.get("limit"));

  function buildWhere(options: { includeStatus?: boolean; includeEventType?: boolean }) {
    const where: string[] = [];
    const values: unknown[] = [];

    if (options.includeStatus !== false && allowedStatuses.has(status)) {
      values.push(status);
      where.push(`status = $${values.length}`);
    }
    if (options.includeEventType !== false && allowedEventTypes.has(eventType)) {
      values.push(eventType);
      where.push(`event_type = $${values.length}`);
    }
    if (q) {
      values.push(`%${q}%`);
      where.push(`(
        event_type ilike $${values.length}
        or source_id ilike $${values.length}
        or recipient_name ilike $${values.length}
        or touser ilike $${values.length}
        or errmsg ilike $${values.length}
        or msgid ilike $${values.length}
      )`);
    }

    return {
      values,
      whereSql: where.length ? `where ${where.join(" and ")}` : ""
    };
  }

  const itemFilter = buildWhere({});
  const totalResult = await dbQuery<{ count: string }>(`select count(*)::text as count from wecom_message_outbox ${itemFilter.whereSql}`, itemFilter.values);

  const itemValues = [...itemFilter.values, limit];
  const itemsResult = await dbQuery(
    `
      ${outboxSelectSql}
      ${itemFilter.whereSql}
      order by created_at desc
      limit $${itemValues.length}
    `,
    itemValues
  );

  const statusFilter = buildWhere({ includeStatus: false });
  const summaryResult = await dbQuery<{ status: string; count: string }>(
    `
      select status, count(*)::text as count
      from wecom_message_outbox
      ${statusFilter.whereSql}
      group by status
      order by status
    `,
    statusFilter.values
  );

  const eventFilter = buildWhere({ includeEventType: false });
  const eventSummaryResult = await dbQuery<{ eventType: string; count: string }>(
    `
      select event_type as "eventType", count(*)::text as count
      from wecom_message_outbox
      ${eventFilter.whereSql}
      group by event_type
      order by event_type
    `,
    eventFilter.values
  );

  return NextResponse.json({
    items: itemsResult.rows,
    summary: summaryResult.rows.map((row) => ({ status: row.status, count: Number(row.count) })),
    eventSummary: eventSummaryResult.rows.map((row) => ({ eventType: row.eventType, count: Number(row.count) })),
    total: Number(totalResult.rows[0]?.count ?? 0)
  });
}

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (currentUser.role !== "总裁") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (!isDbStateReadEnabled()) {
    return NextResponse.json({ error: "db_state_not_enabled" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "missing_outbox_id" }, { status: 400 });

  const row = await getOutboxItem(id);
  if (!row) return NextResponse.json({ error: "outbox_not_found" }, { status: 404 });
  if (!retryableStatuses.has(row.status)) {
    return NextResponse.json({ error: "outbox_status_not_retryable", status: row.status }, { status: 409 });
  }
  if (!row.touser) {
    return NextResponse.json({ error: "missing_touser" }, { status: 400 });
  }

  await markWecomOutboxAttempt(row.id);
  const result: WecomSendResult = await sendWecomTextcard({
    touser: row.touser,
    title: row.title,
    description: row.description ?? "",
    url: resolveRetryUrl(row),
    btntxt: row.btntxt || "进入系统"
  }).catch((error) => ({
    errcode: -1,
    errmsg: error instanceof Error ? error.message : "unknown_send_error"
  }));

  await markWecomOutboxResult(row.id, result);
  const updated = await getOutboxItem(row.id);

  return NextResponse.json({
    item: updated,
    result,
    retried: true
  });
}
