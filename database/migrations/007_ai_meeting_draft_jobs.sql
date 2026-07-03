create table if not exists ai_meeting_draft_jobs (
  id text primary key,
  status text not null,
  request_json jsonb not null,
  result_json jsonb,
  error text,
  error_detail text,
  created_by text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists ai_meeting_draft_jobs_created_by_idx on ai_meeting_draft_jobs (created_by);
create index if not exists ai_meeting_draft_jobs_status_idx on ai_meeting_draft_jobs (status);
