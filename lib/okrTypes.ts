export type OkrRiskLevel = "高" | "中" | "低";
export type OkrPriority = "高" | "中" | "低";
export type OkrProjectStatus = "草稿" | "待总裁审批" | "进行中" | "已延期" | "已完成" | "已暂停" | "已关闭";
export type OkrKrStatus = "未开始" | "进行中" | "已提交待复核" | "已完成" | "已延期" | "阻塞中";
export type OkrTaskStatus = "未开始" | "进行中" | "已提交待复核" | "已完成" | "已延期" | "阻塞中" | "已取消";
export type OkrMetricStatus = "未开始" | "进行中" | "已达成" | "有风险";
export type OkrPdcaStage = "Plan" | "Do" | "Check" | "Act";
export type OkrProjectChangeRequestStatus = "待审批" | "已通过" | "已驳回";

export type OkrMetric = {
  label: string;
  base: string;
  target: string;
  current: string;
  status: OkrMetricStatus;
};

export type OkrKR = {
  id: string;
  projectId: string;
  code: string;
  title: string;
  description: string;
  metric: string;
  targetValue?: string;
  currentValue?: string;
  weight: number;
  owner: string;
  ownerId?: string;
  department: string;
  departmentId?: string;
  reviewer?: string;
  reviewerId?: string;
  startDate: string;
  endDate: string;
  progress: number;
  status: OkrKrStatus;
  riskLevel: OkrRiskLevel;
};

export type OkrPDCATask = {
  id: string;
  projectId: string;
  krId: string;
  pdcaStage: OkrPdcaStage;
  title: string;
  content: string;
  owner: string;
  ownerId?: string;
  ownerDepartment: string;
  ownerDepartmentId?: string;
  reviewer?: string;
  reviewerId?: string;
  collaboratorDepartments: string[];
  collaboratorDepartmentIds?: string[];
  startDate: string;
  endDate: string;
  deliverable: string;
  status: OkrTaskStatus;
  riskLevel: OkrRiskLevel;
  completionItems?: string[];
  reviewSubmittedAt?: string;
  reviewTargetStatus?: OkrTaskStatus;
  reviewedAt?: string;
  reviewRejectedAt?: string;
  reviewRejectedReason?: string;
  reviewRejectedItems?: string[];
  completionHistory?: OkrTaskProgressEntry[];
};

export type OkrTaskProgressEntry = {
  id: string;
  submittedAt: string;
  submittedBy?: string;
  targetStatus?: OkrTaskStatus;
  items: string[];
};

export type OkrRelatedMeeting = {
  id: string;
  title: string;
  date: string;
  host: string;
  decision: string;
  todoCount: number;
  status: string;
};

export type OkrRelatedTask = {
  id: string;
  content: string;
  krId: string;
  sourceMeeting: string;
  owner: string;
  ownerDepartment: string;
  collaboratorDepartments: string[];
  dueDate: string;
  status: Exclude<OkrTaskStatus, "已取消">;
  riskLevel: OkrRiskLevel;
};

export type OkrRisk = {
  id: string;
  description: string;
  krId?: string;
  departments: string[];
  riskLevel: OkrRiskLevel;
  impact: string;
  suggestion: string;
  needPresidentCoordination: boolean;
};

export type OkrProject = {
  id: string;
  name: string;
  category: string;
  objective: string;
  background: string;
  owner: string;
  ownerId?: string;
  ownerDepartment: string;
  ownerDepartmentId?: string;
  collaboratorDepartments: string[];
  collaboratorDepartmentIds?: string[];
  startDate: string;
  endDate: string;
  periodText?: string;
  priority: OkrPriority;
  riskLevel: OkrRiskLevel;
  status: OkrProjectStatus;
  progress: number;
  needPresidentDecisionCount: number;
  krs: OkrKR[];
  pdcaTasks: OkrPDCATask[];
  metrics: OkrMetric[];
  relatedMeetings: OkrRelatedMeeting[];
  relatedTasks: OkrRelatedTask[];
  risks: OkrRisk[];
  supportRequests: string[];
};

export type OkrProjectChangeField = {
  field: string;
  label: string;
  before: string;
  after: string;
  approvalRequired: boolean;
};

export type OkrProjectChangeRequest = {
  id: string;
  projectId: string;
  projectName: string;
  requestedById?: string;
  requestedByName: string;
  requestedAt: string;
  reviewedById?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  status: OkrProjectChangeRequestStatus;
  reason: string;
  reviewComment?: string;
  approvalRequired: boolean;
  changeSummary: string;
  changedFields: OkrProjectChangeField[];
  originalProject?: OkrProject;
  proposedProject?: OkrProject;
};
