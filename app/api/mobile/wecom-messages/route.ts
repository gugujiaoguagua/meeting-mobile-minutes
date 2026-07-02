import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { dbQuery, isDbStateReadEnabled } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OutboxMessageRow = {
  id: string;
  eventType: string;
  sourceType: string;
  sourceId: string;
  title: string;
  description: string;
  status: "pending" | "sent" | "failed" | "skipped";
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
};

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "；")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .replace(/；+/g, "；")
    .replace(/^；|；$/g, "")
    .trim();
}

function shortTime(value?: string) {
  const date = value ? new Date(value) : undefined;
  if (!date || Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function toneFromEvent(eventType: string): "normal" | "navy" | "success" | "wait" | "risk" {
  if (eventType.includes("rejected")) return "risk";
  if (eventType.includes("confirmed") || eventType.includes("approved")) return "success";
  if (eventType.includes("submitted")) return "wait";
  if (eventType.includes("okr")) return "navy";
  return "normal";
}

function sourceFromStatus(status: OutboxMessageRow["status"]) {
  if (status === "sent") return "企业微信通知 · 已发送";
  if (status === "failed") return "企业微信通知 · 发送失败";
  if (status === "skipped") return "企业微信通知 · 未外发";
  return "企业微信通知 · 待发送";
}

function messageIdFor(row: OutboxMessageRow) {
  if (row.sourceType === "task") {
    if (row.eventType === "task_approval_approved") return `approval-approved-${row.sourceId}`;
    if (row.eventType === "task_approval_rejected") return `approval-rejected-${row.sourceId}`;
  }
  return `wecom-outbox-${row.id}`;
}

function taskIdFor(row: OutboxMessageRow) {
  if (row.sourceType === "task" || row.sourceType === "okr_pdca_task") return row.sourceId;
  return undefined;
}

function meetingIdFor(row: OutboxMessageRow) {
  return row.sourceType === "meeting" ? row.sourceId : undefined;
}

function clampLimit(value: string | null) {
  const parsed = Number.parseInt(value || "80", 10);
  if (!Number.isFinite(parsed)) return 80;
  return Math.min(Math.max(parsed, 1), 120);
}

export async function GET(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  if (!isDbStateReadEnabled()) {
    return NextResponse.json({ messages: [] });
  }

  const url = new URL(request.url);
  const limit = clampLimit(url.searchParams.get("limit"));
  const result = await dbQuery<OutboxMessageRow>(
    `
      select
        id,
        event_type as "eventType",
        source_type as "sourceType",
        source_id as "sourceId",
        title,
        description,
        status,
        created_at as "createdAt",
        updated_at as "updatedAt",
        sent_at as "sentAt"
      from wecom_message_outbox
      where recipient_user_id = $1
      order by created_at desc
      limit $2
    `,
    [currentUser.id, limit]
  );

  const messages = result.rows.map((row) => {
    const rawTime = row.sentAt || row.updatedAt || row.createdAt;
    return {
      id: messageIdFor(row),
      title: row.title,
      source: sourceFromStatus(row.status),
      time: shortTime(rawTime),
      body: stripHtml(row.description) || row.eventType,
      actionLabel: taskIdFor(row) ? "查看待办" : "查看详情",
      tone: toneFromEvent(row.eventType),
      taskId: taskIdFor(row),
      meetingId: meetingIdFor(row),
      sortTime: new Date(rawTime).getTime() || Date.now()
    };
  });

  return NextResponse.json({ messages });
}
