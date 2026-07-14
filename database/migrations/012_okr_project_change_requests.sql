begin;

create table if not exists okr_project_change_requests (
  id text primary key,
  project_id text not null references okr_projects(id) on delete cascade,
  project_name text not null default '',
  requested_by_id text references users(id) on delete set null,
  requested_by_name text not null default '',
  requested_at timestamptz not null default now(),
  reviewed_by_id text references users(id) on delete set null,
  reviewed_by_name text,
  reviewed_at timestamptz,
  status text not null check (status in ('待审批', '已通过', '已驳回')),
  reason text not null default '',
  review_comment text,
  approval_required boolean not null default true,
  change_summary text not null default '',
  changed_fields jsonb not null default '[]'::jsonb,
  original_project jsonb,
  proposed_project jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists okr_project_change_requests_project_id_idx on okr_project_change_requests (project_id);
create index if not exists okr_project_change_requests_status_idx on okr_project_change_requests (status);
create index if not exists okr_project_change_requests_requested_by_idx on okr_project_change_requests (requested_by_id);

commit;
