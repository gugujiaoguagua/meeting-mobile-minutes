begin;

update user_accounts a
set username = case
      when a.username like '%-旧-%' then a.username
      else a.username || '-旧-' || a.user_id
    end,
    disabled = true,
    updated_at = now()
from users u
where u.id = a.user_id
  and coalesce(u.source, '') <> 'wecom'
  and (a.disabled = false or a.username not like '%-旧-%');

with eligible_users as (
  select *
  from users u
  where coalesce(u.source, '') = 'wecom'
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
