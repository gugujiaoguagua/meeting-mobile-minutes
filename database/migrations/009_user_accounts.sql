begin;

create table if not exists user_accounts (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  username text not null unique,
  password_hash text not null,
  must_change_password boolean not null default false,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_accounts_user_id_unique on user_accounts (user_id);
create index if not exists user_accounts_disabled_idx on user_accounts (disabled);

with eligible_users as (
  select *
  from users u
  where not (
    coalesce(u.source, '') = 'wecom'
    and exists (
      select 1
      from users business_user
      where business_user.name = u.name
        and business_user.id <> u.id
        and coalesce(business_user.source, '') <> 'wecom'
        and business_user.id not like 'u-%'
    )
  )
  and not (
    u.id like 'u-%'
    and exists (
      select 1
      from users business_user
      where business_user.name = u.name
        and business_user.id <> u.id
        and business_user.id not like 'u-%'
    )
  )
),
ranked_users as (
  select
    id,
    name,
    employee_no,
    count(*) over (partition by name) as same_name_count
  from eligible_users
),
seed_accounts as (
  select
    'account-' || id as id,
    id as user_id,
    case
      when same_name_count = 1 then name
      else name || '-' || coalesce(employee_no, id)
    end as username
  from ranked_users
)
insert into user_accounts (id, user_id, username, password_hash, must_change_password)
select
  id,
  user_id,
  username,
  'scrypt$d5e39426a1045a8a6167c539894dd208$1240710b7d47d4cf91a153afb8e62511dbb92d1f2d6733a8ce4de9c42eb679e8bd4763ef0b4ec7ccdc13e8f096c7db422a077224d7c9576c75f3c22c958843b4',
  false
from seed_accounts
on conflict (user_id) do nothing;

commit;
