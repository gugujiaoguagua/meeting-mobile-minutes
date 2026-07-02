import type { Department, Meeting, Task, User } from "./types";

export const TODAY = "2026-06-19";

export const departments: Department[] = [
  {
    id: "dept-president",
    name: "总裁办",
    managerId: "u-linyuchen",
    description: "关注公司经营节奏、跨部门协同和异常事项。"
  },
  {
    id: "dept-store",
    name: "直营门店",
    managerId: "u-meifeng",
    description: "负责门店周会、客户需求表、设计师产能和订单转化。"
  },
  {
    id: "dept-rd",
    name: "研发部",
    managerId: "u-yexin",
    description: "负责产品研发、板材需求分析和新品打样。"
  },
  {
    id: "dept-it",
    name: "IT部",
    managerId: "u-liwen",
    description: "负责内部系统、企业微信嵌入和数据台账。"
  },
  {
    id: "dept-after-sales",
    name: "售后部",
    managerId: "u-jiangwenxuan",
    description: "负责售后复盘、客诉预警和服务流程改善。"
  },
  {
    id: "dept-training",
    name: "培训部",
    managerId: "u-caizhiwen",
    description: "负责门店 SOP、客户需求表规范和员工培训。"
  },
  {
    id: "dept-design",
    name: "设计部",
    managerId: "u-huaizhu",
    description: "负责量尺、方案交付和设计产能协同。"
  },
  {
    id: "dept-audit",
    name: "直营审核组",
    managerId: "u-caomengyuan",
    description: "负责直营门店审单标准、交付卡点复核和跨部门标准落地。"
  }
];

export const users: User[] = [
  {
    id: "u-linyuchen",
    name: "林昱辰",
    role: "总裁",
    departmentId: "dept-president",
    title: "总裁"
  },
  {
    id: "u-meifeng",
    name: "美凤",
    role: "部门负责人",
    departmentId: "dept-store",
    title: "直营负责人"
  },
  {
    id: "u-yexin",
    name: "叶欣",
    role: "部门负责人",
    departmentId: "dept-rd",
    title: "研发负责人"
  },
  {
    id: "u-liwen",
    name: "李文",
    role: "员工",
    departmentId: "dept-it",
    title: "系统开发"
  },
  {
    id: "u-caizhiwen",
    name: "蔡志文",
    role: "员工",
    departmentId: "dept-training",
    title: "培训运营"
  },
  {
    id: "u-jiangwenxuan",
    name: "蒋文轩",
    role: "部门负责人",
    departmentId: "dept-after-sales",
    title: "售后负责人"
  },
  {
    id: "u-huaizhu",
    name: "怀柱",
    role: "部门负责人",
    departmentId: "dept-design",
    title: "设计负责人"
  },
  {
    id: "u-caomengyuan",
    name: "曹梦圆",
    role: "部门负责人",
    departmentId: "dept-audit",
    title: "直营审核组负责人"
  }
];

const disabledMeetingSeeds: Meeting[] = [
  {
    id: "m-store-weekly",
    title: "直营门店周会：客户需求表与设计师产能",
    departmentId: "dept-store",
    type: "门店周会",
    hostId: "u-meifeng",
    participantIds: ["u-meifeng", "u-huaizhu", "u-caizhiwen"],
    startTime: "2026-06-16 09:30",
    durationMinutes: 76,
    rawTranscript:
      "本周 19 家门店需按 SOP 完成周会。问水店小区团购新增订单较多，设计师排期偏紧；多家门店反馈客户咨询胡桃木板材和中古风颜色。客户需求表上传质量不一致，部分导购仍通过截图补交。",
    summary:
      "会议围绕直营门店周会执行、客户需求沉淀和设计师产能风险展开。问水店订单量明显高于设计师消化能力，需要提前调配设计资源；胡桃木板材需求在多店出现，应同步研发评估市场价值；客户需求表仍存在填写不规范问题，需要培训部统一规范。",
    conclusions: [
      "门店周会必须沉淀客户异常、产品需求和待办动作。",
      "问水店设计师产能需在客户投诉前提前预警。",
      "胡桃木板材需求需进入研发评估清单。"
    ],
    status: "summarized",
    createdAt: "2026-06-16 11:00"
  },
  {
    id: "m-ai-project",
    title: "AI 会议闭环系统需求同步会",
    departmentId: "dept-it",
    type: "AI项目会议",
    hostId: "u-linyuchen",
    participantIds: ["u-linyuchen", "u-liwen", "u-caizhiwen", "u-jiangwenxuan"],
    startTime: "2026-06-18 11:40",
    durationMinutes: 46,
    rawTranscript:
      "飞书妙记、多维表格和企业微信方案都存在状态回写和权限限制。会议系统应先自研 Demo，聚焦会议沉淀、纪要生成、待办分发、统一台账和总裁驾驶舱。第一阶段不接真实语音和 AI 接口。",
    summary:
      "会议确认 AI 会议闭环系统优先走自研 Demo 路径。Demo 要展示从会议记录到纪要、待办、台账、驾驶舱的完整闭环，未来可嵌入企业微信并兼容飞书。技术团队先做框架和演示流程，再逐步接入组织架构、提醒机器人和语音识别能力。",
    conclusions: [
      "第一版目标是展示产品方向和业务闭环，不追求生产级接口。",
      "统一待办台账必须支持状态回写，避免员工重复操作。",
      "总裁驾驶舱只关注会议效率、完成率、逾期风险和异常事项。"
    ],
    status: "summarized",
    createdAt: "2026-06-18 12:26"
  },
  {
    id: "m-after-sales",
    title: "售后复盘会：量尺错误与需求沟通",
    departmentId: "dept-after-sales",
    type: "售后复盘",
    hostId: "u-jiangwenxuan",
    participantIds: ["u-jiangwenxuan", "u-huaizhu", "u-caizhiwen"],
    startTime: "2026-06-14 15:00",
    durationMinutes: 62,
    rawTranscript:
      "近期严重客诉主要集中在量尺数据错误和客户需求未同步给设计师。需要把客户需求表作为订单必填材料，并在门店周会中复盘缺失情况。",
    summary:
      "会议复盘严重客诉的两类根因：量尺错误与需求沟通不到位。售后部建议把客户需求表纳入订单关键检查项，设计部需明确量尺复核动作，培训部补充导购填写规范。",
    conclusions: [
      "严重客诉需在售后复盘会中形成可追踪待办。",
      "客户需求表缺失会直接影响设计与下单准确率。",
      "量尺复核动作需要制度化。"
    ],
    status: "summarized",
    createdAt: "2026-06-14 16:12"
  },
  {
    id: "m-rd-board",
    title: "研发会议：胡桃木板材需求评估",
    departmentId: "dept-rd",
    type: "研发会议",
    hostId: "u-yexin",
    participantIds: ["u-yexin", "u-meifeng", "u-liwen"],
    startTime: "2026-06-17 14:00",
    durationMinutes: 54,
    rawTranscript:
      "门店多次反馈客户寻找胡桃木颜色板材。研发部需要判断是否有稳定市场需求，并结合历史会议记录统计出现频次。",
    summary:
      "会议确认胡桃木板材需求需要做初步市场评估。研发部负责整理样板方向，IT 部支持从会议记录中统计相关关键词出现频次，直营门店补充真实客户案例。",
    conclusions: [
      "胡桃木板材进入研发观察池。",
      "会议数据可作为产品需求判断依据。",
      "门店需补充客户案例，避免仅凭单点反馈立项。"
    ],
    status: "summarized",
    createdAt: "2026-06-17 14:58"
  }
];

export const meetings: Meeting[] = [];

const disabledTaskSeeds: Task[] = [
  {
    id: "t-store-capacity",
    title: "评估问水店设计师产能并提出订单分流方案",
    description: "核对问水店本周新增订单、设计师排期和可消化订单量，必要时协调真北店承接部分订单。",
    meetingId: "m-store-weekly",
    ownerId: "u-huaizhu",
    departmentId: "dept-design",
    collaboratorDepartmentIds: ["dept-store"],
    companySupportRequest: "需要公司协调真北店临时承接超出产能的设计订单",
    dueDate: "2026-06-20",
    priority: "高",
    status: "进行中",
    createdAt: "2026-06-16 11:05",
    updatedAt: "2026-06-18 17:20"
  },
  {
    id: "t-board-demand",
    title: "整理胡桃木板材客户需求案例",
    description: "从门店周会中收集胡桃木、中古风颜色相关客户反馈，整理给研发部评估。",
    meetingId: "m-store-weekly",
    ownerId: "u-meifeng",
    departmentId: "dept-store",
    collaboratorDepartmentIds: ["dept-rd"],
    dueDate: "2026-06-21",
    priority: "中",
    status: "未开始",
    createdAt: "2026-06-16 11:05",
    updatedAt: "2026-06-16 11:05"
  },
  {
    id: "t-demo-prototype",
    title: "完成 AI 会议闭环系统第一版 Demo",
    description: "完成会议列表、新建会议、纪要生成、待办台账、我的待办、部门看板和总裁驾驶舱。",
    meetingId: "m-ai-project",
    ownerId: "u-liwen",
    departmentId: "dept-it",
    collaboratorDepartmentIds: ["dept-president"],
    companySupportRequest: "需要总裁确认第一版演示范围，并协调业务部门参与验收",
    dueDate: "2026-06-18",
    priority: "高",
    status: "进行中",
    createdAt: "2026-06-18 12:28",
    updatedAt: "2026-06-18 18:30"
  },
  {
    id: "t-wecom-plan",
    title: "梳理企业微信嵌入和提醒机器人方案",
    description: "明确 Demo 后续如何挂到企业微信应用内，并通过机器人提醒责任人更新任务。",
    meetingId: "m-ai-project",
    ownerId: "u-caizhiwen",
    departmentId: "dept-training",
    collaboratorDepartmentIds: ["dept-it"],
    companySupportRequest: "需要 IT 部提供企业微信应用接口资料和测试账号",
    dueDate: "2026-06-24",
    priority: "中",
    status: "未开始",
    createdAt: "2026-06-18 12:29",
    updatedAt: "2026-06-18 12:29"
  },
  {
    id: "t-measure-check",
    title: "制定量尺复核检查清单",
    description: "把量尺易错项沉淀为设计师复核清单，减少严重售后风险。",
    meetingId: "m-after-sales",
    ownerId: "u-huaizhu",
    departmentId: "dept-design",
    collaboratorDepartmentIds: ["dept-after-sales"],
    dueDate: "2026-06-18",
    priority: "高",
    status: "未开始",
    createdAt: "2026-06-14 16:20",
    updatedAt: "2026-06-14 16:20"
  },
  {
    id: "t-demand-form-training",
    title: "输出客户需求表填写培训材料",
    description: "针对导购重复截图、漏填需求的问题，制作门店培训材料和检查标准。",
    meetingId: "m-after-sales",
    ownerId: "u-caizhiwen",
    departmentId: "dept-training",
    collaboratorDepartmentIds: ["dept-store", "dept-after-sales"],
    dueDate: "2026-06-22",
    priority: "中",
    status: "进行中",
    createdAt: "2026-06-14 16:21",
    updatedAt: "2026-06-17 10:00"
  },
  {
    id: "t-keyword-report",
    title: "统计历史会议中胡桃木板材相关提及频次",
    description: "从会议记录中统计胡桃木、中古风、木色板材等关键词，为研发立项提供依据。",
    meetingId: "m-rd-board",
    ownerId: "u-liwen",
    departmentId: "dept-it",
    collaboratorDepartmentIds: ["dept-rd", "dept-store"],
    dueDate: "2026-06-23",
    priority: "低",
    status: "未开始",
    createdAt: "2026-06-17 15:00",
    updatedAt: "2026-06-17 15:00"
  },
  {
    id: "t-sample-board",
    title: "准备胡桃木板材初步样板方向",
    description: "根据门店反馈准备 2-3 个可讨论的胡桃木颜色样板方向。",
    meetingId: "m-rd-board",
    ownerId: "u-yexin",
    departmentId: "dept-rd",
    collaboratorDepartmentIds: ["dept-store"],
    dueDate: "2026-06-26",
    priority: "中",
    status: "未开始",
    createdAt: "2026-06-17 15:01",
    updatedAt: "2026-06-17 15:01"
  }
];

export const tasks: Task[] = [];
