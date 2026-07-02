-- Stage 5.1 PostgreSQL schema draft for the meeting loop app.
-- This migration preserves current JSON string IDs such as emp-cp25040, org-29, m-..., and ai-task-....

begin;

create table if not exists departments (
  id text primary key,
  name text not null,
  manager_id text,
  description text not null default '',
  org_code text,
  full_path text,
  org_type text,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  name text not null,
  role text not null check (role in ('总裁', '部门负责人', '员工')),
  department_id text references departments(id) on delete set null,
  title text not null default '',
  employee_no text unique,
  manager_id text,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_department_id_idx on users (department_id);
create index if not exists users_manager_id_idx on users (manager_id);
create index if not exists departments_manager_id_idx on departments (manager_id);

create table if not exists meetings (
  id text primary key,
  title text not null,
  department_id text references departments(id) on delete set null,
  meeting_type text not null check (meeting_type in ('门店周会', '研发会议', '售后复盘', 'AI项目会议', '经营例会', '培训会议')),
  host_id text references users(id) on delete set null,
  participant_count integer,
  start_time timestamptz not null,
  end_time timestamptz,
  duration_minutes integer not null check (duration_minutes >= 0),
  total_man_hours numeric(10,2),
  raw_transcript text not null default '',
  transcript text,
  uploaded_file_name text,
  source_batch_id text,
  source_file_name text,
  source_extracted_at timestamptz,
  source_template_name text,
  source_template_version text,
  okr_project_id text,
  okr_project_name text,
  summary text not null default '',
  ai_summary text,
  minute_markdown text,
  conclusions jsonb not null default '[]'::jsonb,
  approval_status text check (approval_status in ('draft', 'ai_generated', 'supervisor_edited', 'pending_president_approval', 'approved', 'rejected', 'in_closed_loop')),
  status text not null check (status in ('draft', 'summarized', 'closed')),
  created_by text references users(id) on delete set null,
  approved_by text references users(id) on delete set null,
  approved_at timestamptz,
  rejected_reason text,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists meetings_department_id_idx on meetings (department_id);
create index if not exists meetings_host_id_idx on meetings (host_id);
create index if not exists meetings_start_time_idx on meetings (start_time desc);
create index if not exists meetings_approval_status_idx on meetings (approval_status);
create index if not exists meetings_status_idx on meetings (status);

create table if not exists meeting_participants (
  meeting_id text not null references meetings(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);

create index if not exists meeting_participants_user_id_idx on meeting_participants (user_id);

create table if not exists meeting_files (
  id text primary key,
  meeting_id text not null references meetings(id) on delete cascade,
  file_name text not null,
  source_type text,
  text_content text,
  status text,
  source_batch_id text,
  created_at timestamptz not null default now()
);

create index if not exists meeting_files_meeting_id_idx on meeting_files (meeting_id);

create table if not exists meeting_minutes (
  id text primary key,
  meeting_id text not null references meetings(id) on delete cascade,
  summary text not null default '',
  ai_summary text,
  minute_markdown text,
  source_template_name text,
  source_template_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meeting_minutes_meeting_id_idx on meeting_minutes (meeting_id);

create table if not exists meeting_decisions (
  id text primary key,
  meeting_id text not null references meetings(id) on delete cascade,
  content text not null,
  owner_id text references users(id) on delete set null,
  impact_scope text not null default '',
  need_president_confirmation boolean not null default false,
  source_batch_id text,
  source_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meeting_decisions_meeting_id_idx on meeting_decisions (meeting_id);
create index if not exists meeting_decisions_owner_id_idx on meeting_decisions (owner_id);

create table if not exists tasks (
  id text primary key,
  meeting_id text not null references meetings(id) on delete cascade,
  content text,
  title text not null,
  description text not null default '',
  owner_id text references users(id) on delete set null,
  owner_label text,
  department_id text references departments(id) on delete set null,
  owner_department_label text,
  reviewer_id text references users(id) on delete set null,
  collaborator_department_ids jsonb not null default '[]'::jsonb,
  collaborator_department_labels jsonb not null default '[]'::jsonb,
  start_date date,
  due_date date not null,
  goal text,
  priority text not null check (priority in ('高', '中', '低')),
  status text not null check (status in ('not_started', 'in_progress', 'pending_review', 'completed', 'overdue', 'blocked', '未开始', '进行中', '已完成')),
  approval_status text check (approval_status in ('draft', 'ai_generated', 'supervisor_edited', 'pending_president_approval', 'approved', 'rejected', 'in_closed_loop')),
  rejected_reason text,
  company_support_request text,
  company_support_status text check (company_support_status in ('pending', 'completed')),
  company_support_completed_at timestamptz,
  completion_items jsonb not null default '[]'::jsonb,
  review_submitted_at timestamptz,
  review_target_status text,
  reviewed_at timestamptz,
  review_rejected_at timestamptz,
  review_rejected_reason text,
  review_rejected_items jsonb not null default '[]'::jsonb,
  source_text text,
  source_batch_id text,
  source_meeting_id text,
  source_file_name text,
  source_decision_id text references meeting_decisions(id) on delete set null,
  source_trace_label text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists tasks_meeting_id_idx on tasks (meeting_id);
create index if not exists tasks_owner_id_idx on tasks (owner_id);
create index if not exists tasks_reviewer_id_idx on tasks (reviewer_id);
create index if not exists tasks_department_id_idx on tasks (department_id);
create index if not exists tasks_status_idx on tasks (status);
create index if not exists tasks_approval_status_idx on tasks (approval_status);
create index if not exists tasks_due_date_idx on tasks (due_date);
create index if not exists tasks_source_decision_id_idx on tasks (source_decision_id);
create index if not exists tasks_pending_review_reviewer_idx on tasks (reviewer_id, updated_at desc) where status = 'pending_review';
create index if not exists tasks_open_owner_due_idx on tasks (owner_id, due_date) where status not in ('completed', '已完成');

create table if not exists task_progress_entries (
  id text primary key,
  task_id text not null references tasks(id) on delete cascade,
  submitted_at timestamptz not null,
  submitted_by text references users(id) on delete set null,
  target_status text,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists task_progress_entries_task_id_idx on task_progress_entries (task_id);
create index if not exists task_progress_entries_submitted_by_idx on task_progress_entries (submitted_by);

create table if not exists task_approval_logs (
  id text primary key,
  task_id text references tasks(id) on delete set null,
  meeting_id text references meetings(id) on delete set null,
  action text not null,
  actor_id text references users(id) on delete set null,
  from_status text,
  to_status text,
  reason text,
  created_at timestamptz not null
);

create index if not exists task_approval_logs_task_id_idx on task_approval_logs (task_id);
create index if not exists task_approval_logs_meeting_id_idx on task_approval_logs (meeting_id);
create index if not exists task_approval_logs_actor_id_idx on task_approval_logs (actor_id);
create index if not exists task_approval_logs_created_at_idx on task_approval_logs (created_at desc);

create table if not exists task_review_logs (
  id text primary key,
  task_id text references tasks(id) on delete set null,
  meeting_id text references meetings(id) on delete set null,
  action text not null,
  actor_id text references users(id) on delete set null,
  from_status text,
  to_status text,
  reason text,
  reason_items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null
);

create index if not exists task_review_logs_task_id_idx on task_review_logs (task_id);
create index if not exists task_review_logs_meeting_id_idx on task_review_logs (meeting_id);
create index if not exists task_review_logs_actor_id_idx on task_review_logs (actor_id);
create index if not exists task_review_logs_created_at_idx on task_review_logs (created_at desc);

create table if not exists notifications (
  id text primary key,
  category text not null,
  title text not null,
  content text not null,
  tone text,
  meeting_id text references meetings(id) on delete cascade,
  task_id text references tasks(id) on delete cascade,
  actor_id text references users(id) on delete set null,
  notification_time timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists notifications_meeting_id_idx on notifications (meeting_id);
create index if not exists notifications_task_id_idx on notifications (task_id);
create index if not exists notifications_actor_id_idx on notifications (actor_id);
create index if not exists notifications_time_idx on notifications (notification_time desc);

create table if not exists notification_reads (
  user_id text not null references users(id) on delete cascade,
  notification_id text not null,
  read_at timestamptz not null default now(),
  primary key (user_id, notification_id)
);

create index if not exists notification_reads_notification_id_idx on notification_reads (notification_id);

create table if not exists activity_logs (
  id text primary key,
  action text not null,
  title text not null,
  detail text not null,
  meeting_id text references meetings(id) on delete set null,
  task_id text references tasks(id) on delete set null,
  actor_id text references users(id) on delete set null,
  actor_name text,
  from_status text,
  to_status text,
  created_at timestamptz not null
);

create index if not exists activity_logs_meeting_id_idx on activity_logs (meeting_id);
create index if not exists activity_logs_task_id_idx on activity_logs (task_id);
create index if not exists activity_logs_actor_id_idx on activity_logs (actor_id);
create index if not exists activity_logs_created_at_idx on activity_logs (created_at desc);

create table if not exists user_preferences (
  user_id text primary key references users(id) on delete cascade,
  theme text,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

commit;
