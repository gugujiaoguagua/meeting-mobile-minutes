import type { Department } from "./types";

export type CanonicalDepartmentDirectory = {
  departments: Department[];
  aliasToCanonicalDepartmentId: Record<string, string>;
};

function normalizeDepartmentPath(value?: string) {
  return value
    ?.trim()
    .replace(/[\\＞>]+/g, "/")
    .split("/")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join("/") ?? "";
}

function departmentIdentityKey(department: Department) {
  const fullPath = normalizeDepartmentPath(department.fullPath);
  return fullPath ? `path:${fullPath}` : `id:${department.id}`;
}

function departmentRank(department: Department) {
  return [
    department.id.startsWith("org-") ? 0 : 1,
    department.source === "wecom" ? 1 : 0,
    department.source === "public-demo" ? 1 : 0,
    department.id
  ] as const;
}

function compareDepartmentRank(left: Department, right: Department) {
  const leftRank = departmentRank(left);
  const rightRank = departmentRank(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    const diff = String(leftRank[index]).localeCompare(String(rightRank[index]));
    if (diff !== 0) return diff;
  }
  return 0;
}

export function buildCanonicalDepartmentDirectory(departments: Department[]): CanonicalDepartmentDirectory {
  const uniqueById = new Map<string, Department>();
  departments.forEach((department) => uniqueById.set(department.id, department));

  const groups = new Map<string, Department[]>();
  uniqueById.forEach((department) => {
    const key = departmentIdentityKey(department);
    groups.set(key, [...(groups.get(key) ?? []), department]);
  });

  const aliasToCanonicalDepartmentId: Record<string, string> = {};
  const canonicalDepartments = [...groups.values()].map((candidates) => {
    const canonical = [...candidates].sort(compareDepartmentRank)[0];
    candidates.forEach((candidate) => {
      if (candidate.id !== canonical.id) aliasToCanonicalDepartmentId[candidate.id] = canonical.id;
    });
    return canonical;
  });

  canonicalDepartments.sort((left, right) =>
    left.name.localeCompare(right.name, "zh-Hans-CN") || left.id.localeCompare(right.id)
  );

  return { departments: canonicalDepartments, aliasToCanonicalDepartmentId };
}

export function canonicalizeDepartmentId(departmentId: string | undefined, aliases: Record<string, string>) {
  if (!departmentId) return departmentId;
  return aliases[departmentId] ?? departmentId;
}

type DepartmentReferenceTask = {
  departmentId: string;
  collaboratorDepartmentIds: string[];
  ownerDepartment?: string;
  collaboratorDepartments?: string[];
};

type DepartmentReferenceState<
  TUser extends { departmentId: string },
  TMeeting extends { departmentId: string; tasks?: DepartmentReferenceTask[] },
  TTask extends DepartmentReferenceTask
> = {
  users: TUser[];
  meetings: TMeeting[];
  tasks: TTask[];
};

export function canonicalizeDepartmentReferences<
  TUser extends { departmentId: string },
  TMeeting extends { departmentId: string; tasks?: DepartmentReferenceTask[] },
  TTask extends DepartmentReferenceTask
>(state: DepartmentReferenceState<TUser, TMeeting, TTask>, aliases: Record<string, string>) {
  const canonicalizeTask = <T extends DepartmentReferenceTask>(task: T) => ({
    ...task,
    departmentId: canonicalizeDepartmentId(task.departmentId, aliases) ?? task.departmentId,
    collaboratorDepartmentIds: [
      ...new Set(
        task.collaboratorDepartmentIds.map(
          (departmentId) => canonicalizeDepartmentId(departmentId, aliases) ?? departmentId
        )
      )
    ]
  });

  return {
    users: state.users.map((user) => ({
      ...user,
      departmentId: canonicalizeDepartmentId(user.departmentId, aliases) ?? user.departmentId
    })),
    meetings: state.meetings.map((meeting) => ({
      ...meeting,
      departmentId: canonicalizeDepartmentId(meeting.departmentId, aliases) ?? meeting.departmentId,
      tasks: meeting.tasks?.map(canonicalizeTask)
    })),
    tasks: state.tasks.map(canonicalizeTask)
  };
}

function readableDepartmentPath(value?: string) {
  const parts = value
    ?.trim()
    .replace(/[\\＞>]+/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts?.join(" / ") ?? "";
}

export function departmentOptionPresentation(department: Department) {
  const meta = readableDepartmentPath(department.fullPath);
  return {
    label: department.name,
    meta,
    searchText: [department.name, meta, department.orgCode, department.orgType]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
  };
}
