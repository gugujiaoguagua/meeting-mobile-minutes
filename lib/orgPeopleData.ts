import { departments as legacyDepartments, users as legacyUsers } from "./mockData";
import type { Department, User } from "./types";

export const orgPeopleGeneratedAt = "public-demo";

const departmentCodeById: Record<string, string> = {
  "dept-president": "president",
  "dept-store": "store",
  "dept-rd": "rd",
  "dept-it": "it",
  "dept-after-sales": "after-sales",
  "dept-training": "training",
  "dept-design": "design",
  "dept-audit": "audit"
};

const employeeNoById: Record<string, string> = {
  "u-linyuchen": "demo-president",
  "u-meifeng": "demo-store-manager",
  "u-yexin": "demo-rd-manager",
  "u-liwen": "demo-it",
  "u-caizhiwen": "demo-training",
  "u-jiangwenxuan": "demo-after-sales",
  "u-huaizhu": "demo-design",
  "u-caomengyuan": "demo-audit"
};

export function realDepartmentId(orgCode: string) {
  return legacyDepartments.find((department) => departmentCodeById[department.id] === orgCode)?.id ?? `org-${orgCode}`;
}

export function realUserId(employeeNo: string) {
  return legacyUsers.find((user) => employeeNoById[user.id] === employeeNo)?.id ?? `emp-${employeeNo.toLowerCase()}`;
}

export const realDepartments: Department[] = legacyDepartments.map((department) => ({
  ...department,
  orgCode: departmentCodeById[department.id] ?? department.id,
  fullPath: department.description,
  orgType: "公开演示组织",
  source: "public-demo"
}));

export const realUsers: User[] = legacyUsers.map((user) => ({
  ...user,
  employeeNo: employeeNoById[user.id] ?? user.id,
  source: "public-demo"
}));

const realDepartmentIds = new Set(realDepartments.map((department) => department.id));
const realUserIds = new Set(realUsers.map((user) => user.id));

const importedPlanningDepartments: Department[] = [
  {
    id: "dept-design-director",
    name: "设计总监",
    managerId: "u-meifeng",
    description: "导入项目计划表中的设计总监责任部门。"
  },
  {
    id: "dept-order-audit",
    name: "审单",
    managerId: "u-caomengyuan",
    description: "导入项目计划表中的审单协同部门。"
  },
  {
    id: "dept-operation-enablement",
    name: "运营赋能组",
    managerId: "u-caizhiwen",
    description: "导入项目计划表中的运营赋能协同部门。"
  },
  {
    id: "dept-product-rd",
    name: "产品研发",
    managerId: "u-linna",
    description: "导入项目计划表中的产品研发协同部门。"
  },
  {
    id: "dept-franchise-audit",
    name: "加盟审核组",
    managerId: "u-longhairong",
    description: "导入项目计划表中的加盟审核协同部门。"
  },
  {
    id: "dept-project-team",
    name: "项目组全体",
    managerId: "u-caomengyuan",
    description: "导入项目计划表中的项目组全体协同部门。"
  }
];

const importedPlanningUsers: User[] = [
  {
    id: "u-wangfan",
    name: "王帆",
    role: "员工",
    departmentId: "dept-it",
    title: "IT执行"
  },
  {
    id: "u-linna",
    name: "林娜",
    role: "部门负责人",
    departmentId: "dept-rd",
    title: "产品研发"
  },
  {
    id: "u-longhairong",
    name: "龙海荣",
    role: "部门负责人",
    departmentId: "dept-audit",
    title: "加盟审核组"
  }
];

export const departments: Department[] = [
  ...realDepartments,
  ...legacyDepartments.filter((department) => !realDepartmentIds.has(department.id)),
  ...importedPlanningDepartments.filter((department) => !realDepartmentIds.has(department.id) && !legacyDepartments.some((item) => item.id === department.id))
];

export const users: User[] = [
  ...realUsers,
  ...legacyUsers.filter((user) => !realUserIds.has(user.id)),
  ...importedPlanningUsers.filter((user) => !realUserIds.has(user.id) && !legacyUsers.some((item) => item.id === user.id))
];

export const defaultMeetingDepartmentId = "dept-it";
export const defaultMeetingHostId = "u-linyuchen";
export const defaultMeetingParticipantIds = ["u-linyuchen", "u-liwen", "u-caizhiwen"];

export function departmentOptionLabel(department: Department) {
  return department.name;
}

export function userOptionLabel(user: User) {
  return `${user.name} / ${user.title || user.role}`;
}

export function departmentSearchText(department: Department) {
  return [department.name, department.fullPath, department.orgCode, department.orgType].filter(Boolean).join(" ").toLowerCase();
}

export function userSearchText(user: User, department?: Department) {
  return [user.name, user.employeeNo, user.title, department?.name, department?.fullPath].filter(Boolean).join(" ").toLowerCase();
}
