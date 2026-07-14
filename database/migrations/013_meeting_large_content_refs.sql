alter table meetings add column if not exists raw_transcript_object_id text references storage_objects(id) on delete set null;
alter table meetings add column if not exists transcript_object_id text references storage_objects(id) on delete set null;
alter table meetings add column if not exists minute_markdown_object_id text references storage_objects(id) on delete set null;

alter table meeting_minutes add column if not exists minute_markdown_object_id text references storage_objects(id) on delete set null;

alter table ai_meeting_draft_jobs add column if not exists request_object_id text references storage_objects(id) on delete set null;
alter table ai_meeting_draft_jobs add column if not exists result_object_id text references storage_objects(id) on delete set null;
