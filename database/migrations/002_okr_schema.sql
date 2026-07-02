-- Stage 5 OKR persistence schema.
-- Keeps current text IDs and stores display labels for compatibility with the existing demo UI.

begin;

create table if not exists okr_projects (
  id text primary key,
  name text not null,
  category text not null default '',
  objective text not null default '',
  background text not null default '',
  owner_id text references users(id) on delete set null,
  owner_label text not null default '',
  owner_department_id text references departments(id) on delete set null,
  owner_department_label text not null default '',
  collaborator_department_ids jsonb not null default '[]'::jsonb,
  collaborator_department_labels jsonb not null default '[]'::jsonb,
  start_date date not null,
  end_date date not null,
  period_text text,
  priority text not null check (priority in ('高', '中', '低')),
  risk_level text not null check (risk_level in ('高', '中', '低')),
  status text not null check (status in ('草稿', '待总裁审批', '进行中', '已延期', '已完成', '已暂停', '已关闭')),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  need_president_decision_count integer not null default 0 check (need_president_decision_count >= 0),
  metrics jsonb not null default '[]'::jsonb,
  related_meetings jsonb not null default '[]'::jsonb,
  related_tasks jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  support_requests jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists okr_projects_owner_id_idx on okr_projects (owner_id);
create index if not exists okr_projects_owner_department_id_idx on okr_projects (owner_department_id);
create index if not exists okr_projects_status_idx on okr_projects (status);
create index if not exists okr_projects_end_date_idx on okr_projects (end_date);

create table if not exists okr_krs (
  id text primary key,
  project_id text not null references okr_projects(id) on delete cascade,
  code text not null,
  title text not null,
  description text not null default '',
  metric text not null default '',
  target_value text,
  current_value text,
  weight integer not null default 0 check (weight >= 0),
  owner_id text references users(id) on delete set null,
  owner_label text not null default '',
  department_id text references departments(id) on delete set null,
  department_label text not null default '',
  reviewer_id text references users(id) on delete set null,
  reviewer_label text,
  start_date date not null,
  end_date date not null,
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  status text not null check (status in ('未开始', '进行中', '已提交待复核', '已完成', '已延期', '阻塞中')),
  risk_level text not null check (risk_level in ('高', '中', '低')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists okr_krs_project_id_idx on okr_krs (project_id);
create index if not exists okr_krs_owner_id_idx on okr_krs (owner_id);
create index if not exists okr_krs_reviewer_id_idx on okr_krs (reviewer_id);
create index if not exists okr_krs_status_idx on okr_krs (status);

create table if not exists okr_pdca_tasks (
  id text primary key,
  project_id text not null references okr_projects(id) on delete cascade,
  kr_id text not null references okr_krs(id) on delete cascade,
  pdca_stage text not null check (pdca_stage in ('Plan', 'Do', 'Check', 'Act')),
  title text not null,
  content text not null default '',
  owner_id text references users(id) on delete set null,
  owner_label text not null default '',
  owner_department_id text references departments(id) on delete set null,
  owner_department_label text not null default '',
  reviewer_id text references users(id) on delete set null,
  reviewer_label text,
  collaborator_department_ids jsonb not null default '[]'::jsonb,
  collaborator_department_labels jsonb not null default '[]'::jsonb,
  start_date date not null,
  end_date date not null,
  deliverable text not null default '',
  status text not null check (status in ('未开始', '进行中', '已提交待复核', '已完成', '已延期', '阻塞中', '已取消')),
  risk_level text not null check (risk_level in ('高', '中', '低')),
  completion_items jsonb not null default '[]'::jsonb,
  review_submitted_at timestamptz,
  review_target_status text,
  reviewed_at timestamptz,
  review_rejected_at timestamptz,
  review_rejected_reason text,
  review_rejected_items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists okr_pdca_tasks_project_id_idx on okr_pdca_tasks (project_id);
create index if not exists okr_pdca_tasks_kr_id_idx on okr_pdca_tasks (kr_id);
create index if not exists okr_pdca_tasks_owner_id_idx on okr_pdca_tasks (owner_id);
create index if not exists okr_pdca_tasks_reviewer_id_idx on okr_pdca_tasks (reviewer_id);
create index if not exists okr_pdca_tasks_status_idx on okr_pdca_tasks (status);
create index if not exists okr_pdca_tasks_end_date_idx on okr_pdca_tasks (end_date);

commit;
