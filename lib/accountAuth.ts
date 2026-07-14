import crypto from "node:crypto";
import { dbQuery, getDatabaseUrl, isDbStateReadEnabled } from "@/lib/db";
import { users } from "@/lib/orgPeopleData";
import type { User } from "@/lib/types";

const defaultPasswordHash = "scrypt$d5e39426a1045a8a6167c539894dd208$1240710b7d47d4cf91a153afb8e62511dbb92d1f2d6733a8ce4de9c42eb679e8bd4763ef0b4ec7ccdc13e8f096c7db422a077224d7c9576c75f3c22c958843b4";

export type UserAccountRecord = {
  id: string;
  userId: string;
  username: string;
  passwordHash: string;
  mustChangePassword: boolean;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  user?: User;
};

type AccountRow = {
  id: string;
  userId: string;
  username: string;
  passwordHash: string;
  mustChangePassword: boolean;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  name: string;
  role: User["role"];
  departmentId: string;
  title: string;
  employeeNo?: string;
  managerId?: string;
  source?: string;
};

function toAccount(row: AccountRow): UserAccountRecord {
  return {
    id: row.id,
    userId: row.userId,
    username: row.username,
    passwordHash: row.passwordHash,
    mustChangePassword: row.mustChangePassword,
    disabled: row.disabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    user: {
      id: row.userId,
      name: row.name,
      role: row.role,
      departmentId: row.departmentId,
      title: row.title,
      employeeNo: row.employeeNo,
      managerId: row.managerId,
      source: row.source
    }
  };
}

function canUseAccountDb() {
  return isDbStateReadEnabled() && Boolean(getDatabaseUrl());
}

function toLocalPreviewAccount(user: User): UserAccountRecord {
  const now = new Date(0).toISOString();
  return {
    id: `local-preview-account-${user.id}`,
    userId: user.id,
    username: user.name,
    passwordHash: defaultPasswordHash,
    mustChangePassword: false,
    disabled: false,
    createdAt: now,
    updatedAt: now,
    user
  };
}

function findLocalPreviewUsersByUsername(username: string) {
  const normalized = username.trim().toLowerCase();
  return users.filter((user) =>
    [user.name, user.id, user.employeeNo].filter(Boolean).some((value) => String(value).trim().toLowerCase() === normalized)
  );
}

function accountSelectSql() {
  return `
    select
      a.id,
      a.user_id as "userId",
      a.username,
      a.password_hash as "passwordHash",
      a.must_change_password as "mustChangePassword",
      a.disabled,
      a.created_at as "createdAt",
      a.updated_at as "updatedAt",
      u.name,
      u.role,
      u.department_id as "departmentId",
      u.title,
      u.employee_no as "employeeNo",
      u.manager_id as "managerId",
      u.source
    from user_accounts a
    join users u on u.id = a.user_id
  `;
}

async function backfillWecomProfilesFromLegacyUsers() {
  await dbQuery(`
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
      )
  `);
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, passwordHash: string) {
  const [scheme, salt, expected] = passwordHash.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

export async function ensureUserAccounts() {
  if (!canUseAccountDb()) return;
  await backfillWecomProfilesFromLegacyUsers();
  await dbQuery(`
    update user_accounts a
    set
      username = case
        when a.username like '%-旧-%' then a.username
        else a.username || '-旧-' || a.user_id
      end,
      disabled = true,
      updated_at = now()
    from users u
    where u.id = a.user_id
      and coalesce(u.source, '') <> 'wecom'
      and (a.disabled = false or a.username not like '%-旧-%')
  `);
  await dbQuery(`
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
    select id, user_id, username, $1, false
    from seed_accounts
    on conflict (user_id) do nothing
  `, [defaultPasswordHash]);
}

export async function findAccountByUsername(username: string) {
  if (!canUseAccountDb()) {
    const matches = findLocalPreviewUsersByUsername(username);
    return matches.length === 1 ? toLocalPreviewAccount(matches[0]) : undefined;
  }
  await ensureUserAccounts();
  const result = await dbQuery<AccountRow>(`${accountSelectSql()} where a.username = $1 and coalesce(u.source, '') = 'wecom'`, [username]);
  return result.rows[0] ? toAccount(result.rows[0]) : undefined;
}

export async function findAccountsByName(name: string) {
  if (!canUseAccountDb()) {
    return users.filter((user) => user.name === name).map(toLocalPreviewAccount);
  }
  await ensureUserAccounts();
  const result = await dbQuery<AccountRow>(`${accountSelectSql()} where u.name = $1 and coalesce(u.source, '') = 'wecom' order by a.username`, [name]);
  return result.rows.map(toAccount);
}

export async function findAccountByUserId(userId: string) {
  if (!canUseAccountDb()) {
    const user = users.find((item) => item.id === userId);
    return user ? toLocalPreviewAccount(user) : undefined;
  }
  await ensureUserAccounts();
  const result = await dbQuery<AccountRow>(`${accountSelectSql()} where a.user_id = $1 and coalesce(u.source, '') = 'wecom'`, [userId]);
  return result.rows[0] ? toAccount(result.rows[0]) : undefined;
}

export async function listAccounts() {
  if (!canUseAccountDb()) return users.map(toLocalPreviewAccount);
  await ensureUserAccounts();
  const result = await dbQuery<AccountRow>(`${accountSelectSql()} where coalesce(u.source, '') = 'wecom' order by u.role, u.name, a.username`);
  return result.rows.map(toAccount);
}

export async function updateAccountPassword(userId: string, password: string) {
  if (!canUseAccountDb()) return;
  const passwordHash = hashPassword(password);
  await dbQuery(
    `update user_accounts set password_hash = $1, must_change_password = false, updated_at = now() where user_id = $2`,
    [passwordHash, userId]
  );
}

export async function setAccountDisabled(userId: string, disabled: boolean) {
  if (!canUseAccountDb()) return;
  await dbQuery(`update user_accounts set disabled = $1, updated_at = now() where user_id = $2`, [disabled, userId]);
}
