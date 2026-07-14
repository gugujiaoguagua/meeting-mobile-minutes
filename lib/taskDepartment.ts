import type { Department, Task } from "./types";

type TaskDepartmentInput = {
  task: Pick<Task, "departmentId" | "ownerDepartment">;
  departments: Department[];
  ownerDepartmentId?: string;
  meetingDepartmentId?: string;
};

function normalized(value?: string) {
  return value?.trim() ?? "";
}

export function resolveTaskDepartmentSelection({
  task,
  departments,
  ownerDepartmentId,
  meetingDepartmentId
}: TaskDepartmentInput) {
  const byId = new Map(departments.map((department) => [department.id, department]));
  const explicitId = [task.departmentId, task.ownerDepartment]
    .map(normalized)
    .find((value) => value && byId.has(value));
  if (explicitId) return explicitId;

  const preferredIds = [ownerDepartmentId, meetingDepartmentId]
    .map(normalized)
    .filter((value) => value && byId.has(value));
  const readableValues = [task.ownerDepartment, task.departmentId].map(normalized).filter(Boolean);

  for (const value of readableValues) {
    const matches = departments.filter(
      (department) => department.name === value || normalized(department.fullPath) === value
    );
    if (matches.length === 1) return matches[0].id;
    const preferredMatch = preferredIds.find((departmentId) => matches.some((department) => department.id === departmentId));
    if (preferredMatch) return preferredMatch;
  }

  return preferredIds[0] ?? "";
}
