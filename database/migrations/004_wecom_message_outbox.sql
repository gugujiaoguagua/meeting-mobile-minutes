-- Enterprise WeChat message outbox.
-- Records every business-triggered WeCom app message without blocking the business action.

begin;

create table if not exists wecom_message_outbox (
  id text primary key,
  event_type text not null,
  source_type text not null,
  source_id text not null,
  dedupe_key text not null unique,
  recipient_user_id text references users(id) on delete set null,
  recipient_name text,
  touser text not null default '',
  agentid integer not null,
  title text not null,
  description text not null,
  url text not null default '',
  btntxt text not null default '进入系统',
  status text not null check (status in ('pending', 'sent', 'failed', 'skipped')),
  errcode integer,
  errmsg text,
  invaliduser text,
  msgid text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wecom_message_outbox_event_type_idx on wecom_message_outbox (event_type);
create index if not exists wecom_message_outbox_source_idx on wecom_message_outbox (source_type, source_id);
create index if not exists wecom_message_outbox_recipient_user_id_idx on wecom_message_outbox (recipient_user_id);
create index if not exists wecom_message_outbox_status_created_at_idx on wecom_message_outbox (status, created_at desc);
create index if not exists wecom_message_outbox_sent_at_idx on wecom_message_outbox (sent_at desc);

commit;
