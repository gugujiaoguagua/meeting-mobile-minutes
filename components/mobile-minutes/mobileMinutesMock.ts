import type { MobileMessage, MobileTask, TranscriptLine } from "./mobileMinutesTypes";

export const sampleTranscript: TranscriptLine[] = [
  { time: "09:31", speaker: "发言人1", text: "我们先确认本周前端一二阶段范围，录音和妙记详情需要形成闭环。" },
  { time: "09:34", speaker: "发言人2", text: "消息侧要和后端业务事件一致，包括纪要生成、待办分配和复核结果。" },
  { time: "09:39", speaker: "发言人3", text: "待办页需要区分我的待办、待我复核、已完成，按钮要随状态变化。" },
  { time: "09:45", speaker: "发言人1", text: "当前先不做真实说话人识别，统一使用发言人编号，避免误导用户。" },
  { time: "09:52", speaker: "发言人2", text: "生成纪要后同步企业微信通知，并把任务写入后端待办列表。" }
];

export const sampleMessages: MobileMessage[] = [
  {
    id: "message-generated",
    title: "会议纪要已生成",
    source: "产品周会 / 移动端闭环",
    time: "刚刚",
    body: "已生成 6 条摘要、4 个待办、1 个风险提醒。",
    actionLabel: "查看纪要",
    tone: "success"
  },
  {
    id: "message-task-assigned",
    title: "待办已分配",
    source: "产品周会 / 移动端闭环",
    time: "3 分钟前",
    body: "任务「补齐消息页状态标签」已分配给发言人2。",
    actionLabel: "查看待办",
    tone: "wait"
  },
  {
    id: "message-review",
    title: "任务待复核",
    source: "Q3 需求评审",
    time: "昨天 18:20",
    body: "发言人3 提交了复核材料，请处理。",
    actionLabel: "去复核",
    tone: "wait"
  },
  {
    id: "message-approved",
    title: "复核通过",
    source: "客户回访复盘",
    time: "周一 11:08",
    body: "任务「整理客户异议清单」已通过复核。",
    actionLabel: "查看结果",
    tone: "success"
  },
  {
    id: "message-rejected",
    title: "复核驳回",
    source: "销售周会同步",
    time: "周一 09:50",
    body: "任务材料缺少截图，请补充后重新提交。",
    actionLabel: "重新处理",
    tone: "risk"
  },
  {
    id: "message-wecom",
    title: "企业微信通知已发送",
    source: "产品周会 / 移动端闭环",
    time: "刚刚",
    body: "纪要通知已发送给本次会议参会人员。",
    actionLabel: "知道了",
    tone: "normal"
  }
];

export const sampleTasks: MobileTask[] = [
  {
    id: "task-detail-transcript",
    title: "补齐妙记详情转写 tab",
    source: "产品周会 / 移动端闭环",
    owner: "发言人1",
    due: "今天 18:00",
    status: "待处理",
    latestAction: "由会议纪要自动生成",
    actionLabel: "提交复核",
    actionKind: "completion",
    tone: "wait",
    tab: "mine"
  },
  {
    id: "task-wecom-template",
    title: "确认企业微信通知模板",
    source: "产品周会 / 移动端闭环",
    owner: "发言人2",
    due: "明天 12:00",
    status: "进行中",
    latestAction: "已同步后端任务池",
    actionLabel: "提交复核",
    actionKind: "submit_review",
    tone: "navy",
    tab: "mine"
  },
  {
    id: "task-state-mapping",
    title: "检查任务状态映射",
    source: "Q3 需求评审",
    owner: "发言人3",
    due: "今天 20:00",
    status: "待复核",
    latestAction: "提交人：发言人1",
    actionLabel: "通过 / 驳回",
    actionKind: "review",
    tone: "wait",
    tab: "review"
  },
  {
    id: "task-customer-objection",
    title: "整理客户异议清单",
    source: "客户回访复盘",
    owner: "发言人2",
    due: "昨天",
    status: "复核通过",
    latestAction: "复核人：发言人3",
    actionLabel: "查看详情",
    actionKind: "view",
    tone: "success",
    tab: "done"
  },
  {
    id: "task-price-screenshot",
    title: "补充价格口径截图",
    source: "销售周会同步",
    owner: "发言人1",
    due: "周五",
    status: "驳回",
    latestAction: "原因：材料不完整",
    actionLabel: "查看详情",
    actionKind: "view",
    tone: "risk",
    tab: "done"
  }
];
