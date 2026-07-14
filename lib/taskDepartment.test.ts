import assert from "node:assert/strict";
import test from "node:test";
import { resolveTaskDepartmentSelection } from "./taskDepartment";
import type { Department } from "./types";

const departments: Department[] = [
  {
    id: "org-8",
    name: "信息技术部",
    managerId: "emp-manager",
    description: "信息技术部",
    orgCode: "8",
    fullPath: "上海拉迷家具有限公司 / 信息技术部",
    orgType: "部门",
    source: "组织架构"
  },
  {
    id: "org-78",
    name: "软件开发组",
    managerId: "emp-manager",
    description: "软件开发组",
    orgCode: "78",
    fullPath: "上海拉迷家具有限公司 / 信息技术部 / 软件开发组",
    orgType: "部门",
    source: "组织架构"
  }
];

test("empty departmentId does not block the ownerDepartment name fallback", () => {
  assert.equal(
    resolveTaskDepartmentSelection({
      task: { departmentId: "", ownerDepartment: "软件开发组" },
      departments
    }),
    "org-78"
  );
});

test("a stale raw department id resolves through the readable department name", () => {
  assert.equal(
    resolveTaskDepartmentSelection({
      task: { departmentId: "wecom-dept-148", ownerDepartment: "软件开发组" },
      departments,
      ownerDepartmentId: "org-78",
      meetingDepartmentId: "org-8"
    }),
    "org-78"
  );
});

test("an explicit valid responsibility department wins over owner and meeting fallbacks", () => {
  assert.equal(
    resolveTaskDepartmentSelection({
      task: { departmentId: "org-8", ownerDepartment: "信息技术部" },
      departments,
      ownerDepartmentId: "org-78",
      meetingDepartmentId: "org-78"
    }),
    "org-8"
  );
});

test("missing task department falls back to the selected owner department", () => {
  assert.equal(
    resolveTaskDepartmentSelection({
      task: { departmentId: "", ownerDepartment: "" },
      departments,
      ownerDepartmentId: "org-78",
      meetingDepartmentId: "org-8"
    }),
    "org-78"
  );
});
