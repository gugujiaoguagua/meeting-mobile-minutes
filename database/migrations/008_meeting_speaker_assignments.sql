alter table meetings
  add column if not exists speaker_assignments jsonb not null default '[]'::jsonb;
