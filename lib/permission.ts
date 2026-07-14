import { departments, users } from "@/lib/orgPeopleData";
import type { OkrProject } from "@/lib/okrTypes";
import type { ActivityLog, Department, Meeting, Task, User } from "@/lib/types";

export type PermissionDirectory = {
  users: User[];
  departments: Department[];
};

function getDirectory(directory?: Partial<PermissionDirectory>): PermissionDirectory {
  return {
    users: directory?.users?.length ? directory.users : users,
    departments: directory?.departments?.length ? directory.departments : departments
  };
}

export function getAccountRoleForUser(user: User) {
  if (user.role === "总裁") return "president";
  if (user.role === "部门负责人") return "manager";
  return "employee";
}

export function getPresidentUserId(userDirectory: User[] = users) {
  return userDirectory.find((user) => user.role === "总裁")?.id ?? users.find((user) => user.role === "总裁")?.id ?? "emp-zc25003";
}

export function getUserDepartmentId(userId?: string, directory?: Partial<PermissionDirectory>) {
  return userId ? getDirectory(directory).users.find((user) => user.id === userId)?.departmentId : undefined;
}

export function resolveUserId(value?: string, directory?: Partial<PermissionDirectory>) {
  if (!value) return undefined;
  const userDirectory = getDirectory(directory).users;
  return userDirectory.find((user) => user.id === value)?.id ?? userDirectory.find((user) => user.name === value)?.id;
}

export function resolveDepartmentId(value?: string, directory?: Partial<PermissionDirectory>) {
  if (!value) return undefined;
  const departmentDirectory = getDirectory(directory).departments;
  return departmentDirectory.find((department) => department.id === value)?.id ?? departmentDirectory.find((department) => department.name === value)?.id;
}

export function getTaskOwnerId(task: Task, directory?: Partial<PermissionDirectory>) {
  return resolveUserId(task.ownerId, directory) ?? task.ownerId ?? resolveUserId(task.owner, directory) ?? task.owner ?? "";
}

export function getTaskDepartmentId(task: Task, directory?: Partial<PermissionDirectory>) {
  return resolveDepartmentId(task.departmentId, directory) ?? task.departmentId ?? resolveDepartmentId(task.ownerDepartment, directory) ?? task.ownerDepartment ?? "";
}

export function getTaskReviewerId(task: Task, meeting?: Meeting, directory?: Partial<PermissionDirectory>) {
  const effectiveDirectory = getDirectory(directory);
  const ownerId = getTaskOwnerId(task, effectiveDirectory);
  if (meeting) {
    if (ownerId === meeting.hostId) {
      const presidentId = getPresidentUserId(effectiveDirectory.users);
      return presidentId !== ownerId ? presidentId : task.reviewerId ?? ownerId;
    }
    if (meeting.hostId && meeting.hostId !== ownerId) return meeting.hostId;
  }
  const directReviewerId = resolveUserId(task.reviewerId, effectiveDirectory);
  if (directReviewerId && directReviewerId !== ownerId) return directReviewerId;
  const owner = effectiveDirectory.users.find((user) => user.id === ownerId);
  const candidates = [
    owner?.managerId,
    effectiveDirectory.departments.find((department) => department.id === getTaskDepartmentId(task, effectiveDirectory))?.managerId,
    meeting ? effectiveDirectory.departments.find((department) => department.id === meeting.departmentId)?.managerId : undefined,
    meeting?.hostId,
    task.reviewerId,
    task.ownerId
  ];
  return candidates.map((userId) => resolveUserId(userId, effectiveDirectory)).find((userId) => Boolean(userId) && userId !== ownerId) ?? directReviewerId ?? meeting?.hostId ?? ownerId;
}

function getTaskCollaboratorDepartmentIds(task: Task) {
  return task.collaboratorDepartments ?? task.collaboratorDepartmentIds ?? [];
}

function findMeeting(meetings: Meeting[], id: string) {
  return meetings.find((meeting) => meeting.id === id);
}

function isUserInMeeting(userId: string, meeting?: Meeting) {
  return Boolean(meeting && (meeting.hostId === userId || meeting.participantIds.includes(userId)));
}

function getTaskRelatedDepartmentIds(task: Task, meeting?: Meeting, directory?: Partial<PermissionDirectory>) {
  return new Set(
    [
      getTaskDepartmentId(task, directory),
      getUserDepartmentId(getTaskOwnerId(task, directory), directory),
      getUserDepartmentId(getTaskReviewerId(task, meeting, directory), directory),
      ...getTaskCollaboratorDepartmentIds(task),
      meeting?.departmentId,
      meeting ? getUserDepartmentId(meeting.hostId, directory) : undefined,
      ...(meeting?.participantIds.map((userId) => getUserDepartmentId(userId, directory)) ?? [])
    ].filter((value): value is string => Boolean(value))
  );
}

export function canViewTask(user: User, task: Task, meetings: Meeting[], directory?: Partial<PermissionDirectory>) {
  const role = getAccountRoleForUser(user);
  if (role === "president") return true;
  const meeting = findMeeting(meetings, task.meetingId);
  const connectedToUser = getTaskOwnerId(task, directory) === user.id || getTaskReviewerId(task, meeting, directory) === user.id;
  if (connectedToUser) return true;
  if (role === "manager") return getTaskRelatedDepartmentIds(task, meeting, directory).has(user.departmentId);
  return false;
}

export function canViewMeetingBoard(user: User) {
  const role = getAccountRoleForUser(user);
  return role === "president" || role === "manager";
}

export function canViewMeeting(user: User, meeting: Meeting, visibleTasks: Task[]) {
  const role = getAccountRoleForUser(user);
  if (role === "president") return true;
  if (meeting.departmentId === user.departmentId) return true;
  if (isUserInMeeting(user.id, meeting)) return true;
  return visibleTasks.some((task) => task.meetingId === meeting.id);
}

export function canViewActivityLog(user: User, log: ActivityLog, visibleMeetingIds: Set<string>, visibleTaskIds: Set<string>) {
  if (getAccountRoleForUser(user) === "president") return true;
  if (log.actorId === user.id) return true;
  if (log.meetingId && visibleMeetingIds.has(log.meetingId)) return true;
  if (log.taskId && visibleTaskIds.has(log.taskId)) return true;
  return false;
}

function getOkrProjectUserIds(project: OkrProject) {
  return new Set(
    [
      project.ownerId,
      ...project.krs.flatMap((kr) => [kr.ownerId, kr.reviewerId]),
      ...project.pdcaTasks.flatMap((task) => [task.ownerId, task.reviewerId])
    ].filter((value): value is string => Boolean(value))
  );
}

function getOkrProjectDepartmentIds(project: OkrProject) {
  return new Set(
    [
      project.ownerDepartmentId,
      ...(project.collaboratorDepartmentIds ?? []),
      ...project.krs.map((kr) => kr.departmentId),
      ...project.pdcaTasks.flatMap((task) => [task.ownerDepartmentId, ...(task.collaboratorDepartmentIds ?? [])])
    ].filter((value): value is string => Boolean(value))
  );
}

export function canViewOkrProject(user: User, project: OkrProject) {
  const role = getAccountRoleForUser(user);
  if (role === "president") return true;
  if (getOkrProjectUserIds(project).has(user.id)) return true;
  if (role === "manager") return getOkrProjectDepartmentIds(project).has(user.departmentId);
  return false;
}

export function filterMeetingTasks(meeting: Meeting, visibleTaskIds: Set<string>) {
  return {
    ...meeting,
    tasks: meeting.tasks?.filter((task) => visibleTaskIds.has(task.id)) ?? []
  };
}
