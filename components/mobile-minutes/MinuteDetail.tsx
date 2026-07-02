import { CheckCircle2, ChevronLeft, FileText, Send, Sparkles, Wand2 } from "lucide-react";
import type { DetailTab, MobileGeneratedMinuteDraft, RecordState } from "./mobileMinutesTypes";
import { sampleTasks, sampleTranscript } from "./mobileMinutesMock";
import { Tag } from "./MobileShell";
import { users } from "@/lib/orgPeopleData";
import type { Meeting, Task } from "@/lib/types";
import styles from "./MobileMinutes.module.css";

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.infoBox}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function formatMeetingTime(value?: string) {
  if (!value) return "未设置时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const day = date.toDateString() === now.toDateString() ? "今天" : `${date.getMonth() + 1}/${date.getDate()}`;
  return `${day} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function transcriptText(meeting?: Meeting) {
  const text = meeting?.transcript || meeting?.rawTranscript || "";
  if (text.trim()) return text;
  return sampleTranscript.map((item) => `${item.time} ${item.speaker}：${item.text}`).join("\n");
}

function countWords(text: string) {
  const chinese = text.match(/[\u4e00-\u9fa5]/g)?.length ?? 0;
  const words = text.replace(/[\u4e00-\u9fa5]/g, " ").trim().split(/\s+/).filter(Boolean).length;
  return chinese + words;
}

function speakerName(source: string | undefined, speakerMap: Map<string, string>, index: number) {
  const key = source?.trim() || `speaker-${index % 3}`;
  if (!speakerMap.has(key)) {
    speakerMap.set(key, `发言人${Math.min(speakerMap.size + 1, 3)}`);
  }
  return speakerMap.get(key) ?? `发言人${(index % 3) + 1}`;
}

function parseTranscript(meeting?: Meeting) {
  if (!meeting?.transcript && !meeting?.rawTranscript) return sampleTranscript;
  const lines = transcriptText(meeting)
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const sourceLines = lines.length > 0 ? lines : transcriptText(meeting).split(/(?<=[。！？!?])/).map((item) => item.trim()).filter(Boolean);
  const speakerMap = new Map<string, string>();

  return sourceLines.slice(0, 80).map((line, index) => {
    const matched = line.match(/^(?:(\d{1,2}:\d{2}(?::\d{2})?)\s*)?([^：:]{1,24})[：:]\s*(.+)$/);
    const time = matched?.[1] || `00:${String(index * 2).padStart(2, "0")}`;
    const speaker = speakerName(matched?.[2], speakerMap, index);
    return {
      time,
      speaker,
      text: matched?.[3]?.trim() || line
    };
  });
}

function summaryItems(meeting: Meeting | undefined, generatedDraft: MobileGeneratedMinuteDraft | undefined, generated: boolean) {
  const items: string[] = [];
  if (generatedDraft?.aiSummary.trim()) items.push(generatedDraft.aiSummary.trim());
  if (meeting?.conclusions?.length) items.push(...meeting.conclusions);
  if (meeting?.summary) items.push(meeting.summary);
  if (meeting?.aiSummary && !items.includes(meeting.aiSummary)) items.push(meeting.aiSummary);
  if (items.length === 0) {
    items.push("确认本阶段只覆盖手机端核心闭环。", "妙记详情暂不做真实说话人识别。", "后端消息与待办需保持业务语义一致。");
  }
  if (generated && !items.some((item) => item.includes("纪要已生成"))) items.push("纪要已生成，下一步可同步消息与待办。");
  return items.slice(0, 8);
}

function ownerName(task: Task) {
  return users.find((user) => user.id === task.ownerId || user.name === task.owner)?.name ?? task.ownerId ?? task.owner ?? "未指定";
}

function reviewerName(task: Task) {
  return users.find((user) => user.id === task.reviewerId)?.name ?? task.reviewerId ?? "未指定";
}

function statusText(task: Task) {
  if (task.approvalStatus === "pending_president_approval") return "待签批";
  if (task.approvalStatus === "rejected") return "已驳回";
  if (task.status === "completed" || task.status === "已完成") return "已完成";
  if (task.status === "pending_review") return "待复核";
  if (task.status === "in_progress" || task.status === "进行中") return "进行中";
  return "待处理";
}

export function MinuteDetail({
  state,
  detailTab,
  meeting,
  onBack,
  onGenerate,
  onConfirmGeneratedMeeting,
  onOpenMessages,
  onOpenTasks,
  onTabChange,
  isGenerating = false,
  isConfirmingGeneratedMeeting = false,
  generationMessage = "",
  confirmMessage = "",
  generatedDraft,
  submittedGeneratedMeetingId
}: {
  state: RecordState;
  detailTab: DetailTab;
  onBack: () => void;
  onGenerate: () => void;
  onConfirmGeneratedMeeting: () => void;
  onOpenMessages: () => void;
  onOpenTasks: () => void;
  onTabChange: (tab: DetailTab) => void;
  meeting?: Meeting;
  isGenerating?: boolean;
  isConfirmingGeneratedMeeting?: boolean;
  generationMessage?: string;
  confirmMessage?: string;
  generatedDraft?: MobileGeneratedMinuteDraft;
  submittedGeneratedMeetingId?: string;
}) {
  const generated = state === "generated";
  const lines = parseTranscript(meeting);
  const fullTranscript = transcriptText(meeting);
  const wordCount = countWords(fullTranscript);
  const statusLabel = generated || meeting?.status === "summarized" || meeting?.minuteMarkdown || meeting?.aiSummary ? "纪要已生成" : "待确认";
  const taskDrafts = generatedDraft?.tasks ?? meeting?.tasks ?? [];
  const meetingTitle = meeting?.title || "产品周会 / 移动端闭环";
  const meetingTime = formatMeetingTime(meeting?.startTime);
  const duration = meeting?.durationMinutes ? `${meeting.durationMinutes}m` : "未计时";
  const canGenerate = wordCount >= 200;
  const canConfirm = generated && Boolean(generatedDraft) && taskDrafts.length > 0 && !submittedGeneratedMeetingId;

  return (
    <div className={styles.contentNoNav}>
      <div className={styles.detailHeader}>
        <div className={styles.detailHeaderRow}>
          <button className={styles.iconButton} type="button" aria-label="返回记录首页" onClick={onBack}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <div>
            <h1 className={styles.detailTitle}>会议妙记</h1>
            <p className={styles.detailSub}>{meetingTime} · 会议时间</p>
          </div>
          <Tag tone={statusLabel === "纪要已生成" ? "success" : "wait"}>{statusLabel}</Tag>
        </div>
      </div>

      <div className={styles.sectionPad}>
        <section className={`${styles.card} ${styles.infoCard}`}>
          <div className={styles.buttonRow}>
            <div className={styles.clip}>
              <h2 className={styles.infoTitle}>{meetingTitle}</h2>
              <p className={styles.smallText}>
                会议时间 {meetingTime} · 录音 {meeting?.durationMinutes ? `${meeting.durationMinutes} 分钟` : "未计时"} · 转写 {wordCount} 字
              </p>
            </div>
            <FileText color="var(--color-brand)" size={22} aria-hidden="true" />
          </div>
          <div className={styles.infoGrid}>
            <InfoBox label="时长" value={duration} />
            <InfoBox label="字数" value={String(wordCount)} />
            <InfoBox label="参会" value={String(meeting?.participantCount ?? meeting?.participantIds?.length ?? 0)} />
          </div>
        </section>

        <div className={`${styles.segmented} ${styles.segmentedThree}`} role="tablist" aria-label="妙记详情">
          {[
            ["summary", "摘要"],
            ["transcript", "转写"],
            ["draft", "待办草稿"]
          ].map(([id, label]) => (
            <button
              className={detailTab === id ? styles.activeSegment : ""}
              key={id}
              type="button"
              role="tab"
              aria-selected={detailTab === id}
              onClick={() => onTabChange(id as DetailTab)}
            >
              {label}
            </button>
          ))}
        </div>

        {detailTab === "summary" ? (
          <section className={`${styles.card} ${styles.summaryCard}`}>
            <p className={styles.summaryTitle}>
              <Sparkles size={18} aria-hidden="true" />
              AI 摘要
            </p>
            <ul className={styles.summaryList}>
              {summaryItems(meeting, generatedDraft, generated).map((item, index) => (
                <li key={`${index}-${item.slice(0, 16)}`}>{item}</li>
              ))}
            </ul>
            {generatedDraft?.minuteMarkdown ? (
              <div className={styles.markdownPreview}>
                <p className={styles.summaryTitle}>会议纪要预览</p>
                <p>{generatedDraft.minuteMarkdown.slice(0, 900)}{generatedDraft.minuteMarkdown.length > 900 ? "..." : ""}</p>
              </div>
            ) : null}
            {generatedDraft?.dictionaryCorrections?.length ? (
              <p className={styles.messageBody}>术语纠错：已应用 {generatedDraft.dictionaryCorrections.length} 条会议词库修正。</p>
            ) : null}
            {!canGenerate ? <p className={styles.messageBody}>当前转写内容过短，暂不能生成正式会议纪要。请上传或录入完整会议转写后再生成。</p> : null}
            {generationMessage ? <p className={styles.messageBody}>{generationMessage}</p> : null}
            {confirmMessage ? <p className={styles.messageBody}>{confirmMessage}</p> : null}
          </section>
        ) : null}

        {detailTab === "transcript" ? (
          <section className={styles.detailList}>
            {lines.map((item, index) => (
              <article className={`${styles.card} ${styles.messageCard}`} key={`${item.time}-${item.speaker}-${index}`}>
                <div className={styles.clip}>
                  <p className={styles.transcriptMeta}>
                    {item.time} · {item.speaker}
                  </p>
                  <p className={styles.transcriptText}>{item.text}</p>
                </div>
              </article>
            ))}
          </section>
        ) : null}

        {detailTab === "draft" ? (
          <section className={styles.detailList}>
            {generatedDraft?.decisions?.length ? (
              <div className={styles.draftSection}>
                <p className={styles.summaryTitle}>
                  <CheckCircle2 size={18} aria-hidden="true" />
                  决策
                </p>
                {generatedDraft.decisions.map((decision) => (
                  <article className={`${styles.card} ${styles.taskCard}`} key={decision.id}>
                    <h3 className={styles.cardTitle}>{decision.content}</h3>
                    <p className={styles.smallText}>
                      负责人 {users.find((user) => user.id === decision.ownerId)?.name ?? decision.ownerId} · 影响范围 {decision.impactScope || "未标注"}
                    </p>
                    <p className={styles.smallText}>{decision.needPresidentConfirmation ? "需要总裁确认" : "无需总裁确认"}</p>
                  </article>
                ))}
              </div>
            ) : null}

            <div className={styles.draftSection}>
              <p className={styles.summaryTitle}>待办草稿</p>
              {taskDrafts.length > 0
                ? taskDrafts.slice(0, 8).map((task) => (
                  <article className={`${styles.card} ${styles.taskCard}`} key={task.id}>
                    <div className={styles.buttonRow}>
                      <h3 className={styles.cardTitle}>{task.title || task.content || "未命名待办"}</h3>
                      <Tag tone={task.status === "completed" || task.status === "已完成" ? "success" : "wait"}>{statusText(task)}</Tag>
                    </div>
                    <p className={styles.smallText}>
                      负责人 {ownerName(task)} · 复核人 {reviewerName(task)} · 截止 {task.dueDate || "未设置"}
                    </p>
                    {task.goal ? <p className={styles.smallText}>目标：{task.goal}</p> : null}
                  </article>
                  ))
                : generated ? (
                    <article className={`${styles.card} ${styles.emptyCard}`}>AI 未生成可提交待办，暂不能提交签批。</article>
                  ) : sampleTasks.slice(0, 3).map((task) => (
                  <article className={`${styles.card} ${styles.taskCard}`} key={task.id}>
                    <div className={styles.buttonRow}>
                      <h3 className={styles.cardTitle}>{task.title}</h3>
                      <Tag tone={task.tone}>{task.status}</Tag>
                    </div>
                    <p className={styles.smallText}>
                      负责人 {task.owner} · 截止 {task.due}
                    </p>
                  </article>
                  ))}
            </div>
          </section>
        ) : null}
      </div>

      <div className={styles.stickyAction}>
        {submittedGeneratedMeetingId ? (
          <div className={styles.stickyActionStack}>
            <button className={styles.primaryButton} type="button" onClick={onOpenTasks}>
              <CheckCircle2 size={18} aria-hidden="true" />
              查看待办
            </button>
            <button className={styles.secondaryButton} type="button" onClick={onOpenMessages}>
              <Send size={18} aria-hidden="true" />
              查看消息
            </button>
          </div>
        ) : generated ? (
          <div className={styles.stickyActionStack}>
            <button className={styles.primaryButton} type="button" onClick={onConfirmGeneratedMeeting} disabled={!canConfirm || isConfirmingGeneratedMeeting}>
              <CheckCircle2 size={18} aria-hidden="true" />
              {isConfirmingGeneratedMeeting ? "正在提交..." : taskDrafts.length ? "确认并提交签批" : "无待办，不能提交"}
            </button>
            <button className={styles.secondaryButton} type="button" onClick={onOpenMessages}>
              <Send size={18} aria-hidden="true" />
              查看生成消息
            </button>
          </div>
        ) : (
          <button className={styles.primaryButton} type="button" onClick={onGenerate} disabled={isGenerating || !canGenerate}>
            <Wand2 size={18} aria-hidden="true" />
            {isGenerating ? "正在生成..." : canGenerate ? "一键生成会议纪要" : "转写过短，不能生成"}
          </button>
        )}
      </div>
    </div>
  );
}
