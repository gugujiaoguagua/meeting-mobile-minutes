create table if not exists okr_pdca_task_progress_entries (
  id text primary key,
  task_id text not null references okr_pdca_tasks(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  submitted_by text references users(id) on delete set null,
  target_status text,
  items jsonb not null default '[]'::jsonb
);

create index if not exists okr_pdca_task_progress_entries_task_id_idx on okr_pdca_task_progress_entries (task_id);
create index if not exists okr_pdca_task_progress_entries_submitted_at_idx on okr_pdca_task_progress_entries (submitted_at desc);
