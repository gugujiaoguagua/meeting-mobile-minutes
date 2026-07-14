create table if not exists storage_objects (
  id text primary key,
  provider text not null check (provider in ('oss')),
  bucket text not null,
  region text not null,
  endpoint text not null,
  object_key text not null,
  owner_type text not null,
  owner_id text not null,
  category text not null,
  original_name text,
  mime_type text,
  size_bytes bigint,
  checksum text,
  created_by text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(provider, bucket, object_key)
);

create index if not exists storage_objects_owner_idx
  on storage_objects (owner_type, owner_id, category);

create index if not exists storage_objects_created_at_idx
  on storage_objects (created_at desc);
