type DirectoryItem = {
  id: string;
};

export type NewMeetingFormDefaults = {
  title: string;
  departmentId: string;
  hostId: string;
  type: string;
  participantIds: string[];
  startTime: string;
  endTime: string;
};

export type MeetingBasicInfo = Pick<NewMeetingFormDefaults, "title" | "departmentId" | "hostId" | "type" | "startTime" | "endTime">;

function localDateTimeValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function uniqueById<T extends DirectoryItem>(items: readonly T[]) {
  const result = new Map<string, T>();
  for (const item of items) {
    if (!item?.id) continue;
    result.set(item.id, item);
  }
  return [...result.values()];
}

export function createNewMeetingFormDefaults(now = new Date()): NewMeetingFormDefaults {
  const end = new Date(now.getTime() + 40 * 60 * 1000);
  return {
    title: "",
    departmentId: "",
    hostId: "",
    type: "",
    participantIds: [],
    startTime: localDateTimeValue(now),
    endTime: localDateTimeValue(end)
  };
}

export function createMeetingFormDirectory<TUser extends DirectoryItem, TDepartment extends DirectoryItem>(
  runtimeUsers: readonly TUser[],
  runtimeDepartments: readonly TDepartment[]
) {
  return {
    users: uniqueById(runtimeUsers),
    departments: uniqueById(runtimeDepartments)
  };
}

export function getMeetingBasicInfoIssues(info: MeetingBasicInfo) {
  const issues: string[] = [];
  if (!info.title.trim()) issues.push("请填写会议主题");
  if (!info.departmentId) issues.push("请选择所属部门");
  if (!info.hostId) issues.push("请选择会议主持人");
  if (!info.type) issues.push("请选择会议类型");
  if (!info.startTime) issues.push("请选择会议开始时间");
  if (!info.endTime) issues.push("请选择会议结束时间");
  if (info.startTime && info.endTime) {
    const start = new Date(info.startTime).getTime();
    const end = new Date(info.endTime).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end <= start) issues.push("会议结束时间必须晚于开始时间");
  }
  return issues;
}
