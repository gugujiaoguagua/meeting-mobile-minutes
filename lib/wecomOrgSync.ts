import { dbQuery, isDbStateReadEnabled, withDbTransaction } from "@/lib/db";
import { getWecomAccessToken, getWecomApiBaseUrl, getWecomPresidentUserIds, getWecomSyncRootDepartmentId } from "@/lib/wecomConfig";
import { readLocalState, updateLocalOrgState } from "@/lib/localStateStore";
import type { Department, Role, User } from "@/lib/types";

type WecomDepartment = {
  id: number;
  name: string;
  parentid?: number;
  order?: number;
  department_leader?: string[];
};

type WecomUser = {
  userid: string;
  name: string;
  department?: number[];
  order?: number[];
  position?: string;
  mobile?: string;
  gender?: string;
  email?: string;
  is_leader_in_dept?: number[];
  direct_leader?: string[];
  enable?: number;
};

type WecomApiResponse<T> = T & {
  errcode?: number;
  errmsg?: string;
};

export type WecomOrgSyncResult = {
  store: "db" | "json";
  departments: number;
  users: number;
  failedDepartments: Array<{ departmentId: number; errmsg: string; errcode?: number }>;
  updatedAt: string;
};

function wecomDepartmentId(id: number | string) {
  return `wecom-dept-${String(id)}`;
}

function wecomUserId(userid: string) {
  return `emp-${userid.trim()}`;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

async function fetchWecomJson<T>(path: string, params: Record<string, string>) {
  const accessToken = await getWecomAccessToken();
  const url = new URL(`${getWecomApiBaseUrl()}${path}`);
  url.searchParams.set("access_token", accessToken);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`wecom_api_${path}_${response.status}`);
  const payload = (await response.json().catch(() => ({}))) as WecomApiResponse<T>;
  if (payload.errcode && payload.errcode !== 0) {
    throw Object.assign(new Error(payload.errmsg || `wecom_api_error_${payload.errcode}`), { errcode: payload.errcode });
  }
  return payload;
}

function buildDepartmentPath(department: WecomDepartment, departmentById: Map<number, WecomDepartment>): string {
  const names: string[] = [];
  let current: WecomDepartment | undefined = department;
  const visited = new Set<number>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.unshift(current.name);
    current = typeof current.parentid === "number" ? departmentById.get(current.parentid) : undefined;
  }
  return names.join(" / ");
}

function resolveUserRole(user: WecomUser, primaryDepartmentId: number, leaderUserIds: Set<string>, rootLeaderUserIds: Set<string>, presidentUserIds: Set<string>): Role {
  if (presidentUserIds.has(user.userid) || rootLeaderUserIds.has(user.userid)) return "总裁";
  if (leaderUserIds.has(user.userid)) return "部门负责人";
  const primaryLeaderFlag = user.department?.findIndex((departmentId) => departmentId === primaryDepartmentId) ?? -1;
  if (primaryLeaderFlag >= 0 && user.is_leader_in_dept?.[primaryLeaderFlag] === 1) return "部门负责人";
  return "员工";
}

function mapOrg(departments: WecomDepartment[], users: WecomUser[]) {
  const departmentById = new Map(departments.map((department) => [department.id, department]));
  const leaderUserIds = new Set(departments.flatMap((department) => department.department_leader ?? []).filter(Boolean));
  const rootDepartmentId = Number.parseInt(getWecomSyncRootDepartmentId(), 10);
  const rootLeaderUserIds = new Set(departmentById.get(rootDepartmentId)?.department_leader ?? []);
  const presidentUserIds = getWecomPresidentUserIds();

  const nextDepartments: Department[] = departments.map((department) => ({
    id: wecomDepartmentId(department.id),
    name: department.name,
    managerId: department.department_leader?.[0] ? wecomUserId(department.department_leader[0]) : "",
    description: buildDepartmentPath(department, departmentById),
    orgCode: String(department.id),
    fullPath: buildDepartmentPath(department, departmentById),
    orgType: "企业微信",
    source: "wecom"
  }));

  const nextUsers: User[] = users
    .filter((user) => nonEmptyString(user.userid) && nonEmptyString(user.name) && user.enable !== 0)
    .map((user) => {
      const primaryDepartmentId = user.department?.[0] ?? rootDepartmentId;
      const role = resolveUserRole(user, primaryDepartmentId, leaderUserIds, rootLeaderUserIds, presidentUserIds);
      return {
        id: wecomUserId(user.userid),
        name: user.name,
        role,
        departmentId: wecomDepartmentId(primaryDepartmentId),
        title: user.position || role,
        employeeNo: user.userid,
        managerId: user.direct_leader?.[0] ? wecomUserId(user.direct_leader[0]) : undefined,
        source: "wecom"
      };
    });

  return { departments: nextDepartments, users: nextUsers };
}

async function fetchWecomOrg() {
  const rootDepartmentId = getWecomSyncRootDepartmentId();
  const departmentPayload = await fetchWecomJson<{ department?: WecomDepartment[] }>("/department/list", { id: rootDepartmentId });
  const departments = departmentPayload.department ?? [];

  const userById = new Map<string, WecomUser>();
  const failedDepartments: WecomOrgSyncResult["failedDepartments"] = [];
  for (const department of departments) {
    try {
      const userPayload = await fetchWecomJson<{ userlist?: WecomUser[] }>("/user/list", { department_id: String(department.id) });
      for (const user of userPayload.userlist ?? []) {
        const existing = userById.get(user.userid);
        userById.set(user.userid, existing ? { ...existing, ...user, department: [...new Set([...(existing.department ?? []), ...(user.department ?? [])])] } : user);
      }
    } catch (error) {
      failedDepartments.push({
        departmentId: department.id,
        errmsg: error instanceof Error ? error.message : "unknown_error",
        errcode: typeof (error as { errcode?: unknown })?.errcode === "number" ? (error as { errcode: number }).errcode : undefined
      });
    }
  }

  return {
    ...mapOrg(departments, [...userById.values()]),
    failedDepartments
  };
}

async function saveLocalOrg(departments: Department[], users: User[]) {
  const current = await readLocalState();
  const nonWecomDepartments = current.departments.filter((department) => department.source !== "wecom");
  const existingUsersByEmployeeNo = new Map(current.users.filter((user) => user.employeeNo).map((user) => [user.employeeNo, user]));
  const mergedUsers = users.map((user) => {
    const existing = user.employeeNo ? existingUsersByEmployeeNo.get(user.employeeNo) : undefined;
    return existing ? { ...existing, ...user, id: existing.id } : user;
  });
  const mergedUserIds = new Set(mergedUsers.map((user) => user.id));
  const nonWecomUsers = current.users.filter((user) => user.source !== "wecom" && !mergedUserIds.has(user.id));
  await updateLocalOrgState({
    departments: [...nonWecomDepartments, ...departments],
    users: [...nonWecomUsers, ...mergedUsers]
  });
}

async function saveDbOrg(departments: Department[], users: User[]) {
  await withDbTransaction(async (client) => {
    for (const department of departments) {
      await client.query(
        `
          insert into departments (id, name, manager_id, description, org_code, full_path, org_type, source, updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,now())
          on conflict (id) do update set
            name = excluded.name,
            manager_id = excluded.manager_id,
            description = excluded.description,
            org_code = excluded.org_code,
            full_path = excluded.full_path,
            org_type = excluded.org_type,
            source = excluded.source,
            updated_at = now()
        `,
        [department.id, department.name, department.managerId || null, department.description, department.orgCode ?? null, department.fullPath ?? null, department.orgType ?? null, department.source ?? null]
      );
    }

    for (const user of users) {
      const existingByEmployeeNo =
        user.employeeNo ?
          await client.query<{ id: string }>("select id from users where employee_no = $1 and id <> $2 limit 1", [user.employeeNo, user.id])
        : undefined;
      const resolvedUserId = existingByEmployeeNo?.rows[0]?.id ?? user.id;
      await client.query(
        `
          insert into users (id, name, role, department_id, title, employee_no, manager_id, source, updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,now())
          on conflict (id) do update set
            name = excluded.name,
            role = excluded.role,
            department_id = excluded.department_id,
            title = excluded.title,
            employee_no = excluded.employee_no,
            manager_id = excluded.manager_id,
            source = excluded.source,
            updated_at = now()
        `,
        [resolvedUserId, user.name, user.role, user.departmentId || null, user.title, user.employeeNo ?? null, user.managerId ?? null, user.source ?? null]
      );
    }
  });
}

export async function syncWecomOrgToSystem(): Promise<WecomOrgSyncResult> {
  const org = await fetchWecomOrg();
  const store = isDbStateReadEnabled() ? "db" : "json";

  if (store === "db") {
    await saveDbOrg(org.departments, org.users);
  } else {
    await saveLocalOrg(org.departments, org.users);
  }

  return {
    store,
    departments: org.departments.length,
    users: org.users.length,
    failedDepartments: org.failedDepartments,
    updatedAt: new Date().toISOString()
  };
}

export async function getWecomOrgSyncStats() {
  if (isDbStateReadEnabled()) {
    const [departmentsResult, usersResult] = await Promise.all([
      dbQuery<{ count: string }>("select count(*)::text as count from departments where source = 'wecom'"),
      dbQuery<{ count: string }>("select count(*)::text as count from users where source = 'wecom'")
    ]);
    return {
      store: "db" as const,
      departments: Number(departmentsResult.rows[0]?.count ?? 0),
      users: Number(usersResult.rows[0]?.count ?? 0)
    };
  }

  const state = await readLocalState();
  return {
    store: "json" as const,
    departments: state.departments.filter((department) => department.source === "wecom").length,
    users: state.users.filter((user) => user.source === "wecom").length
  };
}
