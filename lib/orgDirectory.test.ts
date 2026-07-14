import assert from "node:assert/strict";
import test from "node:test";

async function loadOrgDirectory() {
  try {
    const moduleUrl = new URL("./orgDirectory.ts", import.meta.url);
    return await import(moduleUrl.href);
  } catch {
    return undefined;
  }
}

test("organization and WeCom copies with the same full path become one department", async () => {
  const model = await loadOrgDirectory();
  assert.ok(model?.buildCanonicalDepartmentDirectory, "canonical department directory is missing");

  const directory = model.buildCanonicalDepartmentDirectory([
    {
      id: "org-78",
      name: "软件开发组",
      managerId: "emp-001",
      description: "",
      fullPath: "上海拉迷家具有限公司/信息技术部/软件开发组",
      source: "organization-export"
    },
    {
      id: "wecom-dept-148",
      name: "软件开发组",
      managerId: "wecom-001",
      description: "",
      fullPath: "上海拉迷家具有限公司 / 信息技术部 / 软件开发组",
      source: "wecom"
    }
  ]);

  assert.deepEqual(directory.departments.map((department: { id: string }) => department.id), ["org-78"]);
  assert.equal(directory.aliasToCanonicalDepartmentId["wecom-dept-148"], "org-78");
});

test("same department names under different paths remain separate", async () => {
  const model = await loadOrgDirectory();
  assert.ok(model?.buildCanonicalDepartmentDirectory, "canonical department directory is missing");

  const directory = model.buildCanonicalDepartmentDirectory([
    {
      id: "org-east-software",
      name: "软件",
      managerId: "emp-east",
      description: "",
      fullPath: "集团/华东/软件",
      source: "organization-export"
    },
    {
      id: "org-west-software",
      name: "软件",
      managerId: "emp-west",
      description: "",
      fullPath: "集团/华西/软件",
      source: "organization-export"
    }
  ]);

  assert.deepEqual(
    directory.departments.map((department: { id: string }) => department.id).sort(),
    ["org-east-software", "org-west-software"]
  );
});

test("department selection uses a concise label while keeping the full path searchable", async () => {
  const model = await loadOrgDirectory();
  assert.ok(model?.departmentOptionPresentation, "department option presentation is missing");

  const presentation = model.departmentOptionPresentation({
    id: "org-store",
    name: "直营门店",
    managerId: "emp-store",
    description: "负责门店周会",
    fullPath: "上海拉迷家具有限公司/直营中心/直营门店",
    orgType: "公开演示组织"
  });

  assert.equal(presentation.label, "直营门店");
  assert.equal(presentation.meta, "上海拉迷家具有限公司 / 直营中心 / 直营门店");
  assert.match(presentation.searchText, /公开演示组织/);
});

test("department aliases are applied to users, meetings and task responsibility fields", async () => {
  const model = await loadOrgDirectory();
  assert.ok(model?.canonicalizeDepartmentReferences, "department reference canonicalizer is missing");

  const result = model.canonicalizeDepartmentReferences(
    {
      users: [{ id: "emp-001", departmentId: "wecom-dept-148" }],
      meetings: [
        {
          id: "meeting-1",
          departmentId: "wecom-dept-148",
          tasks: [
            {
              id: "meeting-task-1",
              departmentId: "wecom-dept-148",
              collaboratorDepartmentIds: ["wecom-dept-148"]
            }
          ]
        }
      ],
      tasks: [
        {
          id: "task-1",
          departmentId: "wecom-dept-148",
          collaboratorDepartmentIds: ["wecom-dept-148", "org-90"],
          ownerDepartment: "软件开发组",
          collaboratorDepartments: ["软件开发组"]
        }
      ]
    },
    { "wecom-dept-148": "org-78" }
  );

  assert.equal(result.users[0]?.departmentId, "org-78");
  assert.equal(result.meetings[0]?.departmentId, "org-78");
  assert.equal(result.meetings[0]?.tasks?.[0]?.departmentId, "org-78");
  assert.equal(result.tasks[0]?.departmentId, "org-78");
  assert.deepEqual(result.tasks[0]?.collaboratorDepartmentIds, ["org-78", "org-90"]);
  assert.equal(result.tasks[0]?.ownerDepartment, "软件开发组");
  assert.deepEqual(result.tasks[0]?.collaboratorDepartments, ["软件开发组"]);
});
