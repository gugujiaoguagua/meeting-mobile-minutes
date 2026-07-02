# 拉迷集团 AI 会议闭环系统 Demo

这是一个本地演示版网页，用来展示“会议记录 → AI 会议纪要 → 待办提取 → 统一台账 → 状态更新 → 管理驾驶舱”的完整闭环。

它不是正式生产系统，不会连接真实企业微信、飞书、语音识别或 AI 接口。当前数据全部是本地模拟数据，方便向技术团队讨论产品方向、页面结构和后续开发需求。

## 你可以演示什么

- 消息通知：汇总签批、驳回、复核、公司支持完成等闭环变化，后续可对接企业微信机器人。
- 新建会议：上传会议文稿，模拟 AI 生成会议纪要、决策和待办事项。
- 管理驾驶舱：按管理权限查看会议数量、会议时长、人工时、待办完成率、逾期风险和公司支持事项。
- 会议列表：统一查看拉迷集团各部门和门店是否上传会议录音或文稿。
- 会议纪要汇总：按“我参与的会议”和“关联到我的会议”查看纪要。
- 会议详情：查看原始记录、AI 纪要、会议结论和会议待办。
- 待办总台账：统一管理所有会议和 OKR 产生的待办。
- 我的待办：切换模拟员工，更新任务状态，处理待复核事项。
- 部门看板：查看直营门店、研发部、IT 部、售后部等部门的会议和任务情况。
- 会议词典：维护公司专有词、人名和容易误识别的词。
- OKR 项目：管理公司级 OKR 项目、KR 拆解、PDCA 任务和复核闭环。

## 启动前准备

这台电脑需要能使用 Node.js。当前项目已经安装好了网页运行依赖。

如果你不确定是否装好了，不用先处理，直接按下面步骤启动；如果启动失败，再找技术同事协助检查 Node.js 环境。

## 如何启动

1. 打开“终端”。

2. 进入这个项目文件夹：

```bash
cd "/Users/ethanlin/Documents/在 MacBook air 上的第一个 codex 项目"
```

3. 启动 Demo：

```bash
PATH="/Users/ethanlin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" /Users/ethanlin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/ethanlin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.cjs start
```

4. 看到终端里出现类似下面的地址后，用浏览器打开：

```text
http://localhost:3000
```

## 演示建议

推荐按这个顺序演示：

1. 先看“消息通知”，说明系统不只是记录任务，还要把状态变化同步给相关人。
2. 进入“新建会议”，上传会议文稿，生成会议纪要、决策和待办。
3. 提交总裁签批，说明待办未签批前不会进入正式台账。
4. 进入“管理驾驶舱”，逐条签批待办，签批后进入正式闭环。
5. 进入“待办总台账”和“我的待办”，演示推进人提交完成、复核人确认后才算完成。
6. 进入“部门看板”，点击数字查看部门待办、剩余、逾期等明细。
7. 进入“会议纪要汇总”，查看我参与的会议和关联到我的会议。
8. 进入“OKR 项目”，演示 KR 拆解、PDCA 任务、任务进入我的待办、KR 复核归档。

## 数据说明

Demo 默认模拟了拉迷集团的真实业务场景：

- 直营门店周会
- AI 会议闭环系统需求同步会
- 售后复盘会
- 研发会议
- 客户需求表
- 胡桃木板材需求
- 设计师产能预警
- 企业微信嵌入和提醒机器人方案
- 三维家模块优化 OKR 项目
- 设计师下单效率 OKR 项目
- 门店客户需求表规范 OKR 项目

任务状态会保存在浏览器本地。点击页面右上角“重置演示数据”，可以恢复到初始状态。

## 交给技术团队前建议阅读

项目里新增了交接说明：

- `docs/AI_TEAM_HANDOFF.md`：给 AI 团队的接手说明，包含系统边界、核心规则、正式版工作量、优先级和自查清单。
- `docs/SYSTEM_RULES.md`：会议、待办、复核、OKR、消息通知的业务规则。
- `docs/PRODUCTION_ROADMAP.md`：从当前 Demo 到公司内部可运行系统的开发路线。

## 常见问题

如果浏览器打不开页面：

- 确认终端里的服务没有关闭。
- 确认打开的是 `http://localhost:3000`。
- 如果 3000 端口被占用，终端会提示另一个地址，例如 `http://localhost:3001`，请打开它提示的新地址。

如果终端提示没有找到构建文件，请先运行一次：

```bash
PATH="/Users/ethanlin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" /Users/ethanlin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/ethanlin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.cjs build
```

构建完成后，再重新运行上面的启动命令。

如果页面数据被改乱：

- 点击右上角“重置演示数据”即可恢复。
