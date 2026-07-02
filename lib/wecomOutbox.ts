import { dbQuery, isDbStateReadEnabled } from "@/lib/db";
import { getWecomAgentId } from "@/lib/wecomConfig";
import type { WecomSendResult } from "@/lib/wecomMessage";

export type WecomOutboxInput = {
  eventType: string;
  sourceType: string;
  sourceId: string;
  dedupeKey: string;
  recipientUserId?: string;
  recipientName?: string;
  touser?: string;
  title: string;
  description: string;
  url?: string;
  btntxt?: string;
};

type ExistingOutboxRow = {
  id: string;
  status: "pending" | "sent" | "failed" | "skipped";
};

export type CreateOutboxResult = {
  id?: string;
  shouldSend: boolean;
  skipped?: boolean;
  existingStatus?: string;
};

function nextOutboxId() {
  return `wecom-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function redactOutboxUrl(url?: string) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/api/wecom/deeplink" && parsed.searchParams.has("token")) {
      parsed.searchParams.set("token", "[redacted]");
    }
    return parsed.toString();
  } catch {
    return url.includes("token=") ? url.replace(/token=[^&]+/g, "token=[redacted]") : url;
  }
}

export async function createWecomOutbox(input: WecomOutboxInput): Promise<CreateOutboxResult> {
  if (!isDbStateReadEnabled()) return { shouldSend: true, skipped: true };

  const id = nextOutboxId();
  const result = await dbQuery<ExistingOutboxRow>(
    `
      insert into wecom_message_outbox (
        id, event_type, source_type, source_id, dedupe_key, recipient_user_id,
        recipient_name, touser, agentid, title, description, url, btntxt, status
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending')
      on conflict (dedupe_key) do nothing
      returning id, status
    `,
    [
      id,
      input.eventType,
      input.sourceType,
      input.sourceId,
      input.dedupeKey,
      input.recipientUserId ?? null,
      input.recipientName ?? null,
      input.touser ?? "",
      getWecomAgentId(),
      input.title,
      input.description,
      redactOutboxUrl(input.url),
      input.btntxt ?? "进入系统"
    ]
  );

  if (result.rows[0]?.id) return { id: result.rows[0].id, shouldSend: true };

  const existing = await dbQuery<ExistingOutboxRow>("select id, status from wecom_message_outbox where dedupe_key = $1", [input.dedupeKey]);
  return { id: existing.rows[0]?.id, shouldSend: false, existingStatus: existing.rows[0]?.status };
}

export async function markWecomOutboxSkipped(input: WecomOutboxInput, reason: string) {
  if (!isDbStateReadEnabled()) return;
  await dbQuery(
    `
      insert into wecom_message_outbox (
        id, event_type, source_type, source_id, dedupe_key, recipient_user_id,
        recipient_name, touser, agentid, title, description, url, btntxt,
        status, errmsg, updated_at
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'skipped',$14,now())
      on conflict (dedupe_key) do update set
        status = case when wecom_message_outbox.status = 'sent' then wecom_message_outbox.status else 'skipped' end,
        errmsg = case when wecom_message_outbox.status = 'sent' then wecom_message_outbox.errmsg else excluded.errmsg end,
        updated_at = now()
    `,
    [
      nextOutboxId(),
      input.eventType,
      input.sourceType,
      input.sourceId,
      input.dedupeKey,
      input.recipientUserId ?? null,
      input.recipientName ?? null,
      input.touser ?? "",
      getWecomAgentId(),
      input.title,
      input.description,
      redactOutboxUrl(input.url),
      input.btntxt ?? "进入系统",
      reason
    ]
  );
}

export async function markWecomOutboxAttempt(outboxId: string) {
  if (!isDbStateReadEnabled()) return;
  await dbQuery(
    `
      update wecom_message_outbox
      set attempt_count = attempt_count + 1,
          last_attempt_at = now(),
          updated_at = now()
      where id = $1
    `,
    [outboxId]
  );
}

export async function markWecomOutboxResult(outboxId: string, result: WecomSendResult) {
  if (!isDbStateReadEnabled()) return;
  const sent = result.errcode === 0;
  await dbQuery(
    `
      update wecom_message_outbox
      set status = $2,
          errcode = $3,
          errmsg = $4,
          invaliduser = $5,
          msgid = $6,
          sent_at = case when $2 = 'sent' then now() else sent_at end,
          updated_at = now()
      where id = $1
    `,
    [
      outboxId,
      sent ? "sent" : "failed",
      result.errcode ?? null,
      result.errmsg ?? null,
      result.invaliduser ?? null,
      result.msgid ?? null
    ]
  );
}
