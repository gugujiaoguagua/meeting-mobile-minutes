alter table okr_projects add column if not exists project_object_id text references storage_objects(id) on delete set null;
alter table okr_projects add column if not exists project_object_key text;

create index if not exists okr_projects_project_object_id_idx on okr_projects (project_object_id);
