import orgPeopleBundle from "../.local-data/meeting-org-people-clean-v1.json";
import { departments as legacyDepartments, users as legacyUsers } from "./mockData";
import type { Department, Role, User } from "./types";

type CleanOrganization = {
  orgCode: string;
  orgName: string;
  orgFullPath: string;
  parentOrgCode: string;
  orgType: string;
  leaderName: string;
  leaderEmployeeNo: string;
  approvalManagers?: Array<{ name?: string; employeeNo?: string }>;
  source: string;
};

type CleanPerson = {
  employeeNo: string;
  name: string;
  departmentName: string;
  departmentFullPath: string;
  departmentCode: string;
  departmentType: string;
  position: string;
  rankName: string;
  managerName: string;
  managerEmployeeNo: string;
  employeeType: string;
  employeeStatus: string;
  source: string;
};

type OrgPeopleBundle = {
  generatedAt: string;
  organizationsForMeeting: CleanOrganization[];
  peopleActive: CleanPerson[];
  backendCurrentPeople: CleanPerson[];
};

const bundle = orgPeopleBundle as OrgPeopleBundle;

export const orgPeopleGeneratedAt = bundle.generatedAt;

export function realDepartmentId(orgCode: string) {
  return `org-${orgCode}`;
}

export function realUserId(employeeNo: string) {
  return `emp-${employeeNo.toLowerCase()}`;
}

const peopleByNo = new Map(bundle.peopleActive.map((person) => [person.employeeNo, person]));
const leaderEmployeeNos = new Set(
  bundle.organizationsForMeeting
    .flatMap((organization) => [
      organization.leaderEmployeeNo,
      ...(organization.approvalManagers ?? []).map((manager) => manager.employeeNo ?? "")
    ])
    .filter(Boolean)
);

function inferRole(person: CleanPerson): Role {
  const title = person.position;
  if (person.name === "林昱辰" || title.includes("总裁") || title.includes("创始人")) return "总裁";
  if (
    leaderEmployeeNos.has(person.employeeNo) ||
    title.includes("总监") ||
    title.includes("经理") ||
    title.includes("主管") ||
    title.includes("店长") ||
    title.includes("组长") ||
    title.includes("负责人")
  ) {
    return "部门负责人";
  }
  return "员工";
}

function managerIdForOrganization(organization: CleanOrganization) {
  if (organization.leaderEmployeeNo && peopleByNo.has(organization.leaderEmployeeNo)) return realUserId(organization.leaderEmployeeNo);
  const approvalManager = organization.approvalManagers?.find((manager) => manager.employeeNo && peopleByNo.has(manager.employeeNo));
  if (approvalManager?.employeeNo) return realUserId(approvalManager.employeeNo);
  return realUserId("ZC25003");
}

export const realDepartments: Department[] = bundle.organizationsForMeeting.map((organization) => ({
  id: realDepartmentId(organization.orgCode),
  name: organization.orgName,
  managerId: managerIdForOrganization(organization),
  description: organization.orgFullPath,
  orgCode: organization.orgCode,
  fullPath: organization.orgFullPath,
  orgType: organization.orgType,
  source: organization.source
}));

export const realUsers: User[] = bundle.peopleActive.map((person) => ({
  id: realUserId(person.employeeNo),
  name: person.name,
  role: inferRole(person),
  departmentId: realDepartmentId(person.departmentCode),
  title: person.position || person.rankName || person.employeeType || "员工",
  employeeNo: person.employeeNo,
  managerId: person.managerEmployeeNo ? realUserId(person.managerEmployeeNo) : undefined,
  source: person.source
}));

const realDepartmentIds = new Set(realDepartments.map((department) => department.id));
const realUserIds = new Set(realUsers.map((user) => user.id));

export const departments: Department[] = [
  ...realDepartments,
  ...legacyDepartments.filter((department) => !realDepartmentIds.has(department.id))
];

export const users: User[] = [
  ...realUsers,
  ...legacyUsers.filter((user) => !realUserIds.has(user.id))
];

export const defaultMeetingDepartmentId = realDepartmentId("34");
export const defaultMeetingHostId = realUserId("ZY25013");
export const defaultMeetingParticipantIds = [realUserId("ZY25013"), realUserId("CP25040"), realUserId("CP25018")];

export function departmentOptionLabel(department: Department) {
  return department.orgType ? `${department.name} / ${department.orgType}` : department.name;
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
