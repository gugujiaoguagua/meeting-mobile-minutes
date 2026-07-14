begin;

with wecom_name_counts as (
  select name, count(*) as wecom_count
  from users
  where coalesce(source, '') = 'wecom'
  group by name
),
legacy_name_counts as (
  select name, count(*) as legacy_count
  from users
  where coalesce(source, '') <> 'wecom'
  group by name
),
ranked_matches as (
  select
    w.id as wecom_id,
    l.role as legacy_role,
    l.department_id as legacy_department_id,
    l.title as legacy_title,
    l.manager_id as legacy_manager_id,
    row_number() over (
      partition by w.id
      order by
        case l.role when '总裁' then 3 when '部门负责人' then 2 else 1 end desc,
        case when nullif(l.title, '') is not null then 1 else 0 end desc,
        case when nullif(l.department_id, '') is not null then 1 else 0 end desc,
        l.id
    ) as rn
  from users w
  join users l on l.name = w.name
  join wecom_name_counts wnc on wnc.name = w.name
  join legacy_name_counts lnc on lnc.name = l.name
  where coalesce(w.source, '') = 'wecom'
    and coalesce(l.source, '') <> 'wecom'
    and (
      (nullif(w.title, '') is not null and nullif(l.title, '') is not null and w.title = l.title)
      or (wnc.wecom_count = 1 and lnc.legacy_count = 1)
    )
),
selected_matches as (
  select *
  from ranked_matches
  where rn = 1
)
update users u
set
  role = case
    when (case selected_matches.legacy_role when '总裁' then 3 when '部门负责人' then 2 else 1 end)
       > (case u.role when '总裁' then 3 when '部门负责人' then 2 else 1 end)
      then selected_matches.legacy_role
    else u.role
  end,
  department_id = coalesce(nullif(u.department_id, ''), selected_matches.legacy_department_id),
  title = coalesce(nullif(u.title, ''), selected_matches.legacy_title, ''),
  manager_id = coalesce(nullif(u.manager_id, ''), selected_matches.legacy_manager_id),
  updated_at = now()
from selected_matches
where u.id = selected_matches.wecom_id
  and (
    (case selected_matches.legacy_role when '总裁' then 3 when '部门负责人' then 2 else 1 end)
      > (case u.role when '总裁' then 3 when '部门负责人' then 2 else 1 end)
    or (nullif(u.department_id, '') is null and selected_matches.legacy_department_id is not null)
    or (nullif(u.title, '') is null and nullif(selected_matches.legacy_title, '') is not null)
    or (nullif(u.manager_id, '') is null and selected_matches.legacy_manager_id is not null)
  );

commit;
