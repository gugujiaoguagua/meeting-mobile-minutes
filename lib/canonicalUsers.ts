import { resolveWecomUserId } from "@/lib/wecomUserMap";
import { buildCanonicalDepartmentDirectory, canonicalizeDepartmentReferences } from "@/lib/orgDirectory";
import type { LocalMeetingLoopState } from "@/lib/localStateStore";
import type { OkrKR, OkrPDCATask, OkrProject } from "@/lib/okrTypes";
import type { ActivityLog, Meeting, MeetingDecision, MeetingSpeakerAssignment, Task, User } from "@/lib/types";

export type CanonicalUserDirectory = {
  users: User[];
  aliasToCanonicalUserId: Record<string, string>;
  wecomUserIdByCanonicalUserId: Record<string, string>;
};

function normalized(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}

function roleRank(user: User) {
  if (user.role === "总裁") return 0;
  if (user.role === "部门负责人") return 1;
  return 2;
}

function isWecomUser(user: User) {
  return user.source === "wecom";
}

function isLegacyDemoUser(user: User) {
  return user.id.startsWith("u-");
}

function isBusinessUser(user: User) {
  return !isWecomUser(user) && !isLegacyDemoUser(user);
}

function directWecomUserId(user: User) {
  const mapped = resolveWecomUserId(user.id);
  if (mapped) return mapped;
  if (isWecomUser(user) && user.employeeNo) return user.employeeNo;
  return undefined;
}

function profileRank(user: User) {
  return [
    roleRank(user),
    isBusinessUser(user) ? 0 : 1,
    user.employeeNo ? 0 : 1,
    isWecomUser(user) ? 1 : 0,
    isLegacyDemoUser(user) ? 1 : 0,
    user.id
  ] as const;
}

function identityRank(user: User) {
  return [
    isWecomUser(user) ? 0 : 1,
    isBusinessUser(user) ? 0 : 1,
    roleRank(user),
    user.employeeNo ? 0 : 1,
    user.id
  ] as const;
}

function compareRank(left: readonly unknown[], right: readonly unknown[]) {
  for (let index = 0; index < left.length; index += 1) {
    const diff = String(left[index]).localeCompare(String(right[index]));
    if (diff !== 0) return diff;
  }
  return 0;
}

function compareProfileUsers(a: User, b: User) {
  return compareRank(profileRank(a), profileRank(b));
}

function compareIdentityUsers(a: User, b: User) {
  return compareRank(identityRank(a), identityRank(b));
}

function addKey(map: Map<string, User[]>, key: string, user: User) {
  if (!key) return;
  map.set(key, [...(map.get(key) ?? []), user]);
}

function profileKey(user: User) {
  if (!user.name || !user.title) return "";
  return `name-title:${normalized(user.name)}:${normalized(user.title)}`;
}

function unambiguousWecomProfileKeys(users: User[]) {
  const grouped = new Map<string, User[]>();
  users.filter(isWecomUser).forEach((user) => {
    const key = profileKey(user);
    if (!key) return;
    grouped.set(key, [...(grouped.get(key) ?? []), user]);
  });
  return new Set([...grouped.entries()].filter(([, items]) => items.length === 1).map(([key]) => key));
}

function baseUserKeys(user: User, uniqueWecomProfileKeys: Set<string>) {
  const keys = new Set<string>();
  const wecomUserId = directWecomUserId(user);
  if (wecomUserId) keys.add(`wecom:${normalized(wecomUserId)}`);
  if (user.employeeNo) keys.add(`employee:${normalized(user.employeeNo)}`);
  const weakProfileKey = profileKey(user);
  if (weakProfileKey && (!isWecomUser(user) || uniqueWecomProfileKeys.has(weakProfileKey))) {
    keys.add(weakProfileKey);
  }
  return [...keys];
}

function userKeys(user: User, legacyAliasNames: Set<string>, uniqueWecomProfileKeys: Set<string>) {
  const keys = new Set(baseUserKeys(user, uniqueWecomProfileKeys));
  if (legacyAliasNames.has(`${normalized(user.name)}:${user.role}`)) {
    keys.add(`legacy-name-role:${normalized(user.name)}:${user.role}`);
  }
  return [...keys];
}

function legacyAliasNames(users: User[]) {
  const businessByNameRole = new Map<string, User[]>();
  users.filter(isBusinessUser).forEach((user) => {
    const key = `${normalized(user.name)}:${user.role}`;
    businessByNameRole.set(key, [...(businessByNameRole.get(key) ?? []), user]);
  });
  const result = new Set<string>();
  users.filter(isLegacyDemoUser).forEach((user) => {
    const key = `${normalized(user.name)}:${user.role}`;
    if ((businessByNameRole.get(key) ?? []).length === 1) result.add(key);
  });
  return result;
}

function pickWecomUserId(candidates: User[]) {
  const wecomCandidate = candidates.find((user) => user.source === "wecom" && directWecomUserId(user));
  return (wecomCandidate ? directWecomUserId(wecomCandidate) : undefined) ?? candidates.map(directWecomUserId).find(Boolean);
}

function mergeUserProfile(identityUser: User, candidates: User[]): User {
  const profileUser = [...candidates].sort(compareProfileUsers)[0] ?? identityUser;
  return {
    ...identityUser,
    role: profileUser.role,
    title: profileUser.title || identityUser.title,
    departmentId: profileUser.departmentId || identityUser.departmentId,
    managerId: profileUser.managerId ?? identityUser.managerId
  };
}

export function buildCanonicalUserDirectory(users: User[]): CanonicalUserDirectory {
  const byId = new Map<string, User>();
  users.forEach((user) => {
    if (!byId.has(user.id)) byId.set(user.id, user);
  });

  const allUsers = [...byId.values()];
  const legacyAliasNameSet = legacyAliasNames(allUsers);
  const uniqueWecomProfileKeys = unambiguousWecomProfileKeys(allUsers);
  const groups = new Map<string, User[]>();
  allUsers.forEach((user) => {
    userKeys(user, legacyAliasNameSet, uniqueWecomProfileKeys).forEach((key) => addKey(groups, key, user));
  });

  const aliasToCanonicalUserId: Record<string, string> = {};
  const wecomUserIdByCanonicalUserId: Record<string, string> = {};
  const canonicalProfiles = new Map<string, User>();
  allUsers.forEach((user) => {
    const related = new Map<string, User>();
    userKeys(user, legacyAliasNameSet, uniqueWecomProfileKeys).forEach((key) => {
      (groups.get(key) ?? []).forEach((item) => related.set(item.id, item));
    });
    const candidates = related.size ? [...related.values()] : [user];
    const canonical = [...candidates].sort(compareIdentityUsers)[0] ?? user;
    if (canonical.id !== user.id) aliasToCanonicalUserId[user.id] = canonical.id;
    const existingProfile = canonicalProfiles.get(canonical.id);
    canonicalProfiles.set(canonical.id, mergeUserProfile(canonical, existingProfile ? [existingProfile, ...candidates] : candidates));
    const wecomUserId = pickWecomUserId(candidates);
    if (wecomUserId) wecomUserIdByCanonicalUserId[canonical.id] = wecomUserId;
  });

  const aliasedIds = new Set(Object.keys(aliasToCanonicalUserId));
  const canonicalUsers = [...canonicalProfiles.values()]
    .filter((user) => !aliasedIds.has(user.id))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN") || a.id.localeCompare(b.id));

  return {
    users: canonicalUsers,
    aliasToCanonicalUserId,
    wecomUserIdByCanonicalUserId
  };
}

export function resolveCanonicalWecomUserId(userId: string | undefined, directory: CanonicalUserDirectory) {
  if (!userId) return undefined;
  const canonicalUserId = canonicalizeUserId(userId, directory.aliasToCanonicalUserId) ?? userId;
  return directory.wecomUserIdByCanonicalUserId[canonicalUserId] ?? resolveWecomUserId(canonicalUserId);
}

export function canonicalizeUserId(userId: string | undefined, aliases: Record<string, string>) {
  if (!userId) return userId;
  return aliases[userId] ?? userId;
}

function canonicalizeDecision(decision: MeetingDecision, aliases: Record<string, string>): MeetingDecision {
  return {
    ...decision,
    ownerId: canonicalizeUserId(decision.ownerId, aliases) ?? decision.ownerId
  };
}

function canonicalizeSpeakerAssignment(assignment: MeetingSpeakerAssignment, aliases: Record<string, string>): MeetingSpeakerAssignment {
  return {
    ...assignment,
    userId: canonicalizeUserId(assignment.userId, aliases) ?? assignment.userId,
    assignedBy: canonicalizeUserId(assignment.assignedBy, aliases) ?? assignment.assignedBy
  };
}

export function canonicalizeTaskUsers<T extends Task>(task: T, aliases: Record<string, string>): T {
  return {
    ...task,
    ownerId: canonicalizeUserId(task.ownerId, aliases) ?? task.ownerId,
    reviewerId: canonicalizeUserId(task.reviewerId, aliases),
    completionHistory: task.completionHistory?.map((entry) => ({
      ...entry,
      submittedBy: canonicalizeUserId(entry.submittedBy, aliases)
    }))
  };
}

function canonicalizeOkrKrUsers(kr: OkrKR, aliases: Record<string, string>): OkrKR {
  return {
    ...kr,
    ownerId: canonicalizeUserId(kr.ownerId, aliases),
    reviewerId: canonicalizeUserId(kr.reviewerId, aliases)
  };
}

export function canonicalizeOkrPdcaTaskUsers<T extends OkrPDCATask>(task: T, aliases: Record<string, string>): T {
  return {
    ...task,
    ownerId: canonicalizeUserId(task.ownerId, aliases),
    reviewerId: canonicalizeUserId(task.reviewerId, aliases),
    completionHistory: task.completionHistory?.map((entry) => ({
      ...entry,
      submittedBy: canonicalizeUserId(entry.submittedBy, aliases)
    }))
  };
}

export function canonicalizeOkrProjectUsers<T extends OkrProject>(project: T, aliases: Record<string, string>): T {
  return {
    ...project,
    ownerId: canonicalizeUserId(project.ownerId, aliases),
    krs: project.krs.map((kr) => canonicalizeOkrKrUsers(kr, aliases)),
    pdcaTasks: project.pdcaTasks.map((task) => canonicalizeOkrPdcaTaskUsers(task, aliases))
  };
}

export function canonicalizeMeetingUsers<T extends Meeting>(meeting: T, aliases: Record<string, string>): T {
  return {
    ...meeting,
    hostId: canonicalizeUserId(meeting.hostId, aliases) ?? meeting.hostId,
    participantIds: [...new Set(meeting.participantIds.map((userId) => canonicalizeUserId(userId, aliases) ?? userId))],
    decisions: meeting.decisions?.map((decision) => canonicalizeDecision(decision, aliases)),
    speakerAssignments: meeting.speakerAssignments?.map((assignment) => canonicalizeSpeakerAssignment(assignment, aliases)),
    tasks: meeting.tasks?.map((task) => canonicalizeTaskUsers(task, aliases)),
    createdBy: canonicalizeUserId(meeting.createdBy, aliases),
    approvedBy: canonicalizeUserId(meeting.approvedBy, aliases)
  };
}

function canonicalizeActivityLog(log: ActivityLog, aliases: Record<string, string>): ActivityLog {
  return {
    ...log,
    actorId: canonicalizeUserId(log.actorId, aliases)
  };
}

function canonicalizeNotificationReads(reads: Record<string, string[]>, aliases: Record<string, string>) {
  const result: Record<string, string[]> = {};
  Object.entries(reads).forEach(([userId, notificationIds]) => {
    const canonicalUserId = canonicalizeUserId(userId, aliases) ?? userId;
    result[canonicalUserId] = [...new Set([...(result[canonicalUserId] ?? []), ...notificationIds])];
  });
  return result;
}

export function canonicalizeMeetingLoopState<T extends LocalMeetingLoopState>(state: T): T & {
  canonicalUserAliases: Record<string, string>;
  canonicalDepartmentAliases: Record<string, string>;
} {
  const departmentDirectory = buildCanonicalDepartmentDirectory(state.departments);
  const departmentReferences = canonicalizeDepartmentReferences(state, departmentDirectory.aliasToCanonicalDepartmentId);
  const directory = buildCanonicalUserDirectory(departmentReferences.users);
  const aliases = directory.aliasToCanonicalUserId;
  return {
    ...state,
    departments: departmentDirectory.departments,
    users: directory.users,
    meetings: departmentReferences.meetings.map((meeting) => canonicalizeMeetingUsers(meeting, aliases)),
    tasks: departmentReferences.tasks.map((task) => canonicalizeTaskUsers(task, aliases)),
    activityLogs: state.activityLogs.map((log) => canonicalizeActivityLog(log, aliases)),
    notificationReadIdsByUser: canonicalizeNotificationReads(state.notificationReadIdsByUser, aliases),
    canonicalUserAliases: aliases,
    canonicalDepartmentAliases: departmentDirectory.aliasToCanonicalDepartmentId
  };
}
