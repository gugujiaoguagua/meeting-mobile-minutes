alter table meetings
  add column if not exists recording_status text,
  add column if not exists recording_status_message text,
  add column if not exists recording_asr_provider text,
  add column if not exists recording_asr_task_id text,
  add column if not exists recording_finalized_at timestamptz;

create index if not exists meetings_recording_status_idx on meetings (recording_status);
