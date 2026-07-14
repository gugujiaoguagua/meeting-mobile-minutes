create table if not exists storage_object_acl (
  id text primary key,
  object_id text not null references storage_objects(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null check (role in ('creator', 'owner', 'participant', 'assignee', 'reviewer', 'approver', 'viewer')),
  source_type text not null,
  source_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (object_id, user_id, role)
);

create index if not exists storage_object_acl_object_idx
  on storage_object_acl (object_id);

create index if not exists storage_object_acl_user_idx
  on storage_object_acl (user_id, role);

create index if not exists storage_object_acl_source_idx
  on storage_object_acl (source_type, source_id);
