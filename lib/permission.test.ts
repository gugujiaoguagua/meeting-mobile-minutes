import assert from "node:assert/strict";
import test from "node:test";

async function loadPermission() {
  try {
    const moduleUrl = new URL("./permission.ts", import.meta.url);
    return await import(moduleUrl.href);
  } catch {
    return undefined;
  }
}

const directory = {
  users: [
    { id: "emp-owner", name: "推进人", role: "员工", departmentId: "org-software", title: "开发" },
    { id: "emp-manager", name: "部门负责人", role: "部门负责人", departmentId: "org-software", title: "负责人" },
    { id: "emp-president", name: "总裁", role: "总裁", departmentId: "org-president", title: "总裁" }
  ],
  departments: [
    { id: "org-software", name: "软件开发组", managerId: "emp-manager", description: "" },
    { id: "org-president", name: "总裁办", managerId: "emp-president", description: "" }
  ]
};

const task = {
  id: "task-1",
  title: "联调",
  description: "",
  meetingId: "meeting-1",
  ownerId: "emp-owner",
  departmentId: "org-software",
  collaboratorDepartmentIds: [],
  dueDate: "2026-07-20",
  priority: "中",
  status: "not_started",
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z"
};

test("runtime department manager is selected as reviewer", async () => {
  const permission = await loadPermission();
  assert.ok(permission?.getTaskReviewerId, "permission module is missing");
  assert.equal(permission.getTaskReviewerId(task, undefined, directory), "emp-manager");
});

test("runtime department manager can see department tasks", async () => {
  const permission = await loadPermission();
  assert.ok(permission?.canViewTask, "permission module is missing");
  assert.equal(permission.canViewTask(directory.users[1], task, [], directory), true);
});
