import { CalendarClock, CheckCircle2, ClipboardList, Download, History, XCircle } from "lucide-react";
import type { MobileReviewTargetStatus, MobileTask, TaskTab } from "./mobileMinutesTypes";
import { sampleTasks } from "./mobileMinutesMock";
import { AppHeader, Tag } from "./MobileShell";
import { downloadTaskExport } from "./mobileMinutesApi";
import styles from "./MobileMinutes.module.css";
import { useEffect, useMemo, useState } from "react";

type ProgressEntry = {
  id: string;
  submittedAt: string;
  targetStatus?: string;
  items: string[];
};

const reviewStatusOptions: Array<{ value: MobileReviewTargetStatus; label: string }> = [
  { value: "in_progress", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "blocked", label: "阻塞中" }
];

function normalizeTargetStatus(value?: string): MobileReviewTargetStatus {
  if (value === "completed" || value === "已完成") return "completed";
  if (value === "blocked" || value === "阻塞中") return "blocked";
  return "in_progress";
}

function reviewTargetLabel(value?: string) {
  const status = normalizeTargetStatus(value);
  if (status === "completed") return "完成";
  if (status === "blocked") return "阻塞";
  return "进度";
}

function progressItemsKey(items: string[] = []) {
  return items.map((item) => item.trim()).filter(Boolean).join("\n");
}

function getProgressEntries(task: MobileTask): ProgressEntry[] {
  const history = task.rawTask?.completionHistory ?? task.rawOkrTask?.completionHistory ?? [];
  const entries: ProgressEntry[] = history.map((entry) => ({
    id: entry.id,
    submittedAt: entry.submittedAt,
    targetStatus: entry.targetStatus,
    items: entry.items ?? []
  }));
  const currentItems = task.completionItems?.map((item) => item.trim()).filter(Boolean) ?? [];
  const currentKey = progressItemsKey(currentItems);
  const alreadyInHistory = entries.some((entry) => progressItemsKey(entry.items) === currentKey);
  if (currentItems.length && !alreadyInHistory) {
    entries.push({
      id: `current-progress-${task.id}`,
      submittedAt: task.rawTask?.reviewSubmittedAt ?? task.rawOkrTask?.reviewSubmittedAt ?? "尚未提交",
      targetStatus: task.rawTask?.reviewTargetStatus ?? task.rawOkrTask?.reviewTargetStatus,
      items: currentItems
    });
  }
  return entries;
}

function getInitialReviewStatus(task: MobileTask): MobileReviewTargetStatus {
  return normalizeTargetStatus(task.rawTask?.reviewTargetStatus ?? task.rawOkrTask?.reviewTargetStatus ?? task.rawTask?.status ?? task.rawOkrTask?.status);
}

function hasSavedCompletion(task: MobileTask) {
  return Boolean(task.completionItems?.some((item) => item.trim()));
}

function taskElementId(taskId: string) {
  return `mobile-task-${encodeURIComponent(taskId)}`;
}

function sourceKindLabel(task: MobileTask) {
  return task.sourceKind === "okr" ? "OKR" : "会议";
}

export function MobileTasks({
  activeTab,
  onTabChange,
  tasks = sampleTasks,
  focusedTaskId,
  busyTaskId,
  onSaveCompletion,
  onSubmitReview,
  onConfirmReview,
  onRejectReview,
  onApproveAllTasks,
  onApproveTask,
  onRejectApproval,
  onCompleteSupport,
  onChangeOkrEndDate
}: {
  activeTab: TaskTab;
  onTabChange: (tab: TaskTab) => void;
  tasks?: MobileTask[];
  focusedTaskId?: string;
  busyTaskId?: string;
  onSaveCompletion?: (task: MobileTask, items: string[]) => void | Promise<void>;
  onSubmitReview?: (task: MobileTask, status: MobileReviewTargetStatus) => void | Promise<void>;
  onConfirmReview?: (task: MobileTask) => void | Promise<void>;
  onRejectReview?: (task: MobileTask, reasonItems: string[]) => void | Promise<void>;
  onApproveAllTasks?: (tasks: MobileTask[]) => void | Promise<void>;
  onApproveTask?: (task: MobileTask) => void | Promise<void>;
  onRejectApproval?: (task: MobileTask, reason: string) => void | Promise<void>;
  onCompleteSupport?: (task: MobileTask) => void | Promise<void>;
  onChangeOkrEndDate?: (task: MobileTask, endDate: string, reason: string) => void | Promise<void>;
}) {
  const visibleTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.tab === activeTab)
        .map((task, index) => ({ task, index }))
        .sort((a, b) => {
          if (a.task.isCurrentUserOwner !== b.task.isCurrentUserOwner) return a.task.isCurrentUserOwner ? -1 : 1;
          return a.index - b.index;
        })
        .map(({ task }) => task),
    [activeTab, tasks]
  );
  const [expandedTaskId, setExpandedTaskId] = useState<string | undefined>(focusedTaskId);
  const [completionTaskId, setCompletionTaskId] = useState<string | undefined>();
  const [progressTask, setProgressTask] = useState<MobileTask | undefined>();
  const [completionDrafts, setCompletionDrafts] = useState<Record<string, string>>({});
  const [rejectDrafts, setRejectDrafts] = useState<Record<string, string>>({});
  const [reviewTargets, setReviewTargets] = useState<Record<string, MobileReviewTargetStatus>>({});
  const [dueDateTaskId, setDueDateTaskId] = useState<string | undefined>();
  const [dueDateDrafts, setDueDateDrafts] = useState<Record<string, string>>({});
  const [dueDateReasons, setDueDateReasons] = useState<Record<string, string>>({});
  const visibleApprovalTasks = visibleTasks.filter((task) => task.actionKind === "approval");

  useEffect(() => {
    if (!focusedTaskId) return;
    const focusedTask = tasks.find((task) => task.id === focusedTaskId);
    if (focusedTask) onTabChange(focusedTask.tab);
    setExpandedTaskId(focusedTaskId);
    const timer = window.setTimeout(() => {
      document.getElementById(taskElementId(focusedTaskId))?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [focusedTaskId, onTabChange, tasks]);

  const counts = useMemo(
    () => ({
      mine: tasks.filter((task) => task.tab === "mine").length,
      review: tasks.filter((task) => task.tab === "review").length,
      approval: tasks.filter((task) => task.tab === "approval").length,
      done: tasks.filter((task) => task.tab === "done").length
    }),
    [tasks]
  );

  function completionText(task: MobileTask) {
    return completionDrafts[task.id] ?? (task.completionItems?.length ? task.completionItems.join("\n") : "");
  }

  function rejectText(task: MobileTask) {
    return rejectDrafts[task.id] ?? "";
  }

  function completionItems(task: MobileTask) {
    return completionText(task).split("\n").map((item) => item.trim()).filter(Boolean);
  }

  function reasonItems(task: MobileTask) {
    return rejectText(task).split("\n").map((item) => item.trim()).filter(Boolean);
  }

  function selectedReviewTarget(task: MobileTask) {
    return reviewTargets[task.id] ?? getInitialReviewStatus(task);
  }

  function canFillTask(task: MobileTask) {
    return task.actionKind === "completion" || task.actionKind === "submit_review";
  }

  function canChangeDueDate(task: MobileTask) {
    return task.sourceKind === "okr" && task.tab === "mine" && Boolean(task.isCurrentUserOwner && task.rawOkrTask);
  }

  function dueDateText(task: MobileTask) {
    return dueDateDrafts[task.id] ?? task.rawOkrTask?.endDate ?? task.due;
  }

  function dueDateReasonText(task: MobileTask) {
    return dueDateReasons[task.id] ?? "";
  }

  return (
    <div className={styles.content}>
      <AppHeader title="待办" />

      <div className={styles.sectionPad}>
        <div className={styles.segmented} role="tablist" aria-label="待办分组">
          {[
            ["mine", `我的 ${counts.mine}`],
            ["review", `复核 ${counts.review}`],
            ["approval", `签批 ${counts.approval}`],
            ["done", `完成 ${counts.done}`]
          ].map(([id, label]) => (
            <button
              className={activeTab === id ? styles.activeSegment : ""}
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => onTabChange(id as TaskTab)}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "approval" && visibleApprovalTasks.length ? (
          <div className={styles.formBlock}>
            <button
              className={styles.successAction}
              type="button"
              disabled={Boolean(busyTaskId)}
              onClick={() => onApproveAllTasks?.(visibleApprovalTasks)}
            >
              <CheckCircle2 size={16} aria-hidden="true" />
              一键通过全部签批
            </button>
          </div>
        ) : null}
        {visibleTasks.length ? (
          <div className={styles.formBlock}>
            <button className={styles.ghostButton} type="button" onClick={() => downloadTaskExport()}>
              <Download size={16} aria-hidden="true" />
              批量下载可见待办
            </button>
          </div>
        ) : null}

        <section className={styles.taskList}>
          {visibleTasks.length === 0 ? (
            <div className={`${styles.card} ${styles.emptyCard}`}>当前分组没有待办。</div>
          ) : null}
          {visibleTasks.map((task) => {
            const progressEntries = getProgressEntries(task);
            const isFilling = completionTaskId === task.id;
            const isChangingDueDate = dueDateTaskId === task.id;
            return (
              <article id={taskElementId(task.id)} className={`${styles.card} ${styles.taskCard} ${focusedTaskId === task.id ? styles.focusCard : ""}`} key={task.id}>
                <div className={styles.buttonRow}>
                  <h2 className={styles.cardTitle}>{task.title}</h2>
                  <Tag tone={task.tone}>{task.status}</Tag>
                </div>
                <p className={styles.messageBody}>来源：{task.source} · {sourceKindLabel(task)}</p>
                <div className={styles.taskMetaGrid}>
                  <div className={styles.taskMeta}>
                    <span>负责人</span> <b>{task.owner}</b>
                  </div>
                  <div className={styles.taskMeta}>
                    <span>截止</span> <b>{task.due}</b>
                  </div>
                  <div className={styles.taskMeta}>
                    <span>复核人</span> <b>{task.reviewer ?? "未设置"}</b>
                  </div>
                  <div className={styles.taskMeta}>
                    <span>动作</span> <b>{task.actionLabel}</b>
                  </div>
                </div>
                <p className={styles.smallText}>最近操作：{task.latestAction}</p>

                <div className={styles.mobileTaskControls}>
                  <button className={styles.controlButton} type="button" onClick={() => setProgressTask(task)}>
                    <History size={15} aria-hidden="true" />
                    查看进度
                    <span>{progressEntries.length ? `${progressEntries.length} 次` : "暂无"}</span>
                  </button>

                  <button className={styles.controlButton} type="button" onClick={() => downloadTaskExport(task.id)}>
                    <Download size={15} aria-hidden="true" />
                    下载任务
                    <span>{sourceKindLabel(task)}</span>
                  </button>

                  {canFillTask(task) ? (
                    <button className={styles.controlButton} type="button" disabled={busyTaskId === task.id} onClick={() => setCompletionTaskId(isFilling ? undefined : task.id)}>
                      <ClipboardList size={15} aria-hidden="true" />
                      任务填写
                      <span>{task.completionItems?.length ? `${task.completionItems.length} 条` : "未填写"}</span>
                    </button>
                  ) : null}

                  {canChangeDueDate(task) ? (
                    <button className={styles.controlButton} type="button" disabled={busyTaskId === task.id} onClick={() => setDueDateTaskId(isChangingDueDate ? undefined : task.id)}>
                      <CalendarClock size={15} aria-hidden="true" />
                      改时间
                      <span>{task.rawOkrTask?.endDate ?? task.due}</span>
                    </button>
                  ) : null}

                  {canFillTask(task) ? (
                    <div className={styles.mobileStatusSubmit}>
                      <select
                        className={styles.mobileStatusSelect}
                        value={selectedReviewTarget(task)}
                        onChange={(event) => setReviewTargets((current) => ({ ...current, [task.id]: event.target.value as MobileReviewTargetStatus }))}
                        disabled={busyTaskId === task.id}
                        aria-label="提交复核目标状态"
                      >
                        {reviewStatusOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <button
                        className={styles.submitReviewButton}
                        type="button"
                        disabled={busyTaskId === task.id || !hasSavedCompletion(task)}
                        onClick={() => onSubmitReview?.(task, selectedReviewTarget(task))}
                      >
                        提交复核
                      </button>
                    </div>
                  ) : null}
                </div>

                <button className={styles.textButton} type="button" onClick={() => setExpandedTaskId(expandedTaskId === task.id ? undefined : task.id)}>
                  {expandedTaskId === task.id ? "收起详情" : "展开详情"}
                </button>

                {expandedTaskId === task.id ? (
                  <div className={styles.taskDetailPanel}>
                    <p className={styles.messageBody}>{task.description}</p>
                    {task.goal ? <p className={styles.smallText}>目标：{task.goal}</p> : null}
                    {task.companySupportRequest ? <p className={styles.smallText}>公司支持：{task.companySupportRequest}</p> : null}
                    {task.reviewRejectedItems?.length ? <p className={styles.smallText}>驳回原因：{task.reviewRejectedItems.join("；")}</p> : null}
                  </div>
                ) : null}

                {isFilling ? (
                  <div className={styles.formBlock}>
                    <label className={styles.formLabel} htmlFor={`completion-${task.id}`}>任务填写内容</label>
                    <textarea
                      id={`completion-${task.id}`}
                      className={styles.mobileTextarea}
                      value={completionText(task)}
                      onChange={(event) => setCompletionDrafts((current) => ({ ...current, [task.id]: event.target.value }))}
                      placeholder="每行填写一条完成内容"
                      rows={3}
                    />
                    <div className={styles.inlineActions}>
                      <button className={styles.ghostButton} type="button" disabled={busyTaskId === task.id} onClick={() => setCompletionTaskId(undefined)}>
                        取消
                      </button>
                      <button
                        className={styles.smallButton}
                        type="button"
                        disabled={busyTaskId === task.id || completionItems(task).length === 0}
                        onClick={async () => {
                          await onSaveCompletion?.(task, completionItems(task));
                          setCompletionTaskId(undefined);
                        }}
                      >
                        保存内容
                      </button>
                    </div>
                  </div>
                ) : null}

                {canFillTask(task) && !hasSavedCompletion(task) ? (
                  <p className={styles.helpText}>请先完成“任务填写”并保存，再提交复核。</p>
                ) : null}

                {isChangingDueDate ? (
                  <div className={styles.formBlock}>
                    <label className={styles.formLabel} htmlFor={`due-date-${task.id}`}>调整 OKR 结束时间</label>
                    <input
                      id={`due-date-${task.id}`}
                      className={styles.mobileStatusSelect}
                      type="date"
                      min={task.rawOkrTask?.startDate}
                      value={dueDateText(task)}
                      onChange={(event) => setDueDateDrafts((current) => ({ ...current, [task.id]: event.target.value }))}
                      disabled={busyTaskId === task.id}
                    />
                    <textarea
                      className={styles.mobileTextarea}
                      value={dueDateReasonText(task)}
                      onChange={(event) => setDueDateReasons((current) => ({ ...current, [task.id]: event.target.value }))}
                      placeholder="填写调整原因，复核人会收到消息"
                      rows={2}
                    />
                    <div className={styles.inlineActions}>
                      <button className={styles.ghostButton} type="button" disabled={busyTaskId === task.id} onClick={() => setDueDateTaskId(undefined)}>
                        取消
                      </button>
                      <button
                        className={styles.smallButton}
                        type="button"
                        disabled={busyTaskId === task.id || !dueDateText(task) || dueDateText(task) === task.rawOkrTask?.endDate}
                        onClick={async () => {
                          await onChangeOkrEndDate?.(task, dueDateText(task), dueDateReasonText(task).trim());
                          setDueDateTaskId(undefined);
                        }}
                      >
                        保存时间
                      </button>
                    </div>
                  </div>
                ) : null}

                {task.actionKind === "review" ? (
                  <div className={styles.actionPair}>
                    <button className={styles.successAction} type="button" disabled={busyTaskId === task.id} onClick={() => onConfirmReview?.(task)}>
                      <CheckCircle2 size={16} aria-hidden="true" />
                      通过
                    </button>
                    <button className={styles.riskAction} type="button" disabled={busyTaskId === task.id} onClick={() => onRejectReview?.(task, reasonItems(task))}>
                      <XCircle size={16} aria-hidden="true" />
                      驳回
                    </button>
                    <textarea
                      className={styles.mobileTextarea}
                      value={rejectText(task)}
                      onChange={(event) => setRejectDrafts((current) => ({ ...current, [task.id]: event.target.value }))}
                      placeholder="驳回时填写原因，可每行一条"
                      rows={2}
                    />
                  </div>
                ) : null}

                {task.actionKind === "approval" ? (
                  <div className={styles.formBlock}>
                    <textarea
                      className={styles.mobileTextarea}
                      value={rejectText(task)}
                      onChange={(event) => setRejectDrafts((current) => ({ ...current, [task.id]: event.target.value }))}
                      placeholder="驳回时填写原因；通过可不填"
                      rows={2}
                    />
                    <div className={styles.actionPair}>
                      <button className={styles.successAction} type="button" disabled={busyTaskId === task.id} onClick={() => onApproveTask?.(task)}>
                        <CheckCircle2 size={16} aria-hidden="true" />
                        签批通过
                      </button>
                      <button className={styles.riskAction} type="button" disabled={busyTaskId === task.id} onClick={() => onRejectApproval?.(task, rejectText(task).trim() || "请补充责任边界、截止时间或达成目标后重新提交。")}>
                        <XCircle size={16} aria-hidden="true" />
                        驳回
                      </button>
                    </div>
                  </div>
                ) : null}

                {task.actionKind === "support" ? (
                  <button className={styles.smallButton} type="button" disabled={busyTaskId === task.id} onClick={() => onCompleteSupport?.(task)}>
                    完成公司支持
                  </button>
                ) : null}
              </article>
            );
          })}
        </section>
      </div>

      {progressTask ? (
        <div className={styles.mobileSheetOverlay} role="dialog" aria-modal="true" aria-label="任务进度">
          <div className={styles.mobileSheet}>
            <div className={styles.buttonRow}>
              <div>
                <h2 className={styles.cardTitle}>任务进度</h2>
                <p className={styles.smallText}>{progressTask.title}</p>
              </div>
              <button className={styles.ghostButton} type="button" onClick={() => setProgressTask(undefined)}>关闭</button>
            </div>
            <div className={styles.progressList}>
              {getProgressEntries(progressTask).length ? (
                getProgressEntries(progressTask).map((entry, entryIndex) => (
                  <div className={styles.progressEntry} key={entry.id}>
                    <div className={styles.progressEntryHead}>
                      <b>第 {entryIndex + 1} 次提交</b>
                      <span>{entry.submittedAt}</span>
                      <span>{reviewTargetLabel(entry.targetStatus)}复核</span>
                    </div>
                    {entry.items.map((item, itemIndex) => (
                      <div className={styles.progressItem} key={`${entry.id}-${itemIndex}`}>
                        <span>{itemIndex + 1}</span>
                        <p>{item}</p>
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                <div className={`${styles.card} ${styles.emptyCard}`}>当前还没有填写任务进度。</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
