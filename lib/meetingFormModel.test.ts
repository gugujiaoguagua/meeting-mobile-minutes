import assert from "node:assert/strict";
import test from "node:test";

async function loadMeetingFormModel() {
  try {
    const moduleUrl = new URL("./meetingFormModel.ts", import.meta.url);
    return await import(moduleUrl.href);
  } catch {
    return undefined;
  }
}

test("new meeting defaults do not contain demo business values", async () => {
  const model = await loadMeetingFormModel();
  assert.ok(model?.createNewMeetingFormDefaults, "meeting form defaults model is missing");

  const defaults = model.createNewMeetingFormDefaults(new Date(2026, 6, 13, 15, 57, 0));

  assert.equal(defaults.title, "");
  assert.equal(defaults.departmentId, "");
  assert.equal(defaults.hostId, "");
  assert.equal(defaults.type, "");
  assert.deepEqual(defaults.participantIds, []);
  assert.equal(defaults.startTime, "2026-07-13T15:57");
  assert.equal(defaults.endTime, "2026-07-13T16:37");
});

test("meeting directory keeps canonical runtime identities", async () => {
  const model = await loadMeetingFormModel();
  assert.ok(model?.createMeetingFormDirectory, "meeting form directory model is missing");

  const runtimeUsers = [
    { id: "emp-001", name: "甲", departmentId: "org-10", role: "员工", employeeNo: "001", source: "roster" },
    { id: "emp-002", name: "乙", departmentId: "org-20", role: "部门负责人", employeeNo: "002", source: "wecom" },
    { id: "emp-001", name: "甲（最新资料）", departmentId: "org-10", role: "员工", employeeNo: "001", source: "roster" }
  ];
  const runtimeDepartments = [
    { id: "org-10", name: "一部", managerId: "emp-001" },
    { id: "org-20", name: "二部", managerId: "emp-002" }
  ];

  const directory = model.createMeetingFormDirectory(runtimeUsers, runtimeDepartments);

  assert.deepEqual(directory.users.map((user: { id: string }) => user.id), ["emp-001", "emp-002"]);
  assert.equal(directory.users[0]?.name, "甲（最新资料）");
  assert.equal(directory.users[1]?.employeeNo, "002");
  assert.deepEqual(directory.departments.map((department: { id: string }) => department.id), ["org-10", "org-20"]);
});

test("meeting basics must be selected before generation or submission", async () => {
  const model = await loadMeetingFormModel();
  assert.ok(model?.getMeetingBasicInfoIssues, "meeting basic validation model is missing");

  assert.deepEqual(
    model.getMeetingBasicInfoIssues({
      title: "",
      departmentId: "",
      hostId: "",
      type: "",
      startTime: "2026-07-13T15:57",
      endTime: "2026-07-13T16:37"
    }),
    ["请填写会议主题", "请选择所属部门", "请选择会议主持人", "请选择会议类型"]
  );

  assert.deepEqual(
    model.getMeetingBasicInfoIssues({
      title: "真实会议",
      departmentId: "org-10",
      hostId: "emp-001",
      type: "经营例会",
      startTime: "2026-07-13T16:37",
      endTime: "2026-07-13T15:57"
    }),
    ["会议结束时间必须晚于开始时间"]
  );
});
