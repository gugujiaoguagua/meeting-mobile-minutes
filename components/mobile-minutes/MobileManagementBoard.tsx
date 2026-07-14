import { type ReactNode } from "react";
import { AlertTriangle, CheckSquare, Clock3, FileText, Users } from "lucide-react";
import { AppHeader, Tag } from "./MobileShell";
import type { MobileManagementMeetingRow, MobileManagementMetrics } from "./mobileMinutesTypes";
import styles from "./MobileMinutes.module.css";

function BoardMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className={styles.boardMetric}>
      <p className={styles.metricLabel}>{label}</p>
      <p className={styles.metricValue}>{value}</p>
    </div>
  );
}

function StatusItem({
  icon,
  label,
  value,
  tone = "normal"
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone?: "normal" | "wait" | "risk" | "success";
}) {
  return (
    <div className={styles.boardStatusItem}>
      <span className={styles.boardStatusIcon}>{icon}</span>
      <span>{label}</span>
      <Tag tone={tone}>{value}</Tag>
    </div>
  );
}

export function MobileManagementBoard({
  metrics,
  attentionMeetings,
  onOpenMeeting
}: {
  metrics: MobileManagementMetrics;
  attentionMeetings: MobileManagementMeetingRow[];
  onOpenMeeting: (meetingId: string) => void;
}) {
  const riskCount = metrics.failedMeetings + metrics.overdueTasks;

  return (
    <div className={styles.content}>
      <AppHeader title="管理驾驶舱" right={<Tag tone="navy">{metrics.scopeLabel}</Tag>} />
      <div className={styles.sectionPad}>
        <section className={`${styles.card} ${styles.boardHero}`}>
          <div className={styles.clip}>
            <p className={styles.boardEyebrow}>会议与待办概览</p>
            <h2 className={styles.boardHeroTitle}>{metrics.totalMeetings} 场会议</h2>
            <p className={styles.smallText}>当前账号可见范围内的会议与会议待办。</p>
          </div>
          <div className={styles.boardHeroBadge}>
            <Users size={22} aria-hidden="true" />
            <span>{metrics.activeMeetingTasks}</span>
            <small>待办</small>
          </div>
        </section>

        <section className={styles.boardMetricGrid} aria-label="管理指标">
          <BoardMetric label="今日会议" value={metrics.todayMeetings} />
          <BoardMetric label="待确认" value={metrics.pendingMinutes} />
          <BoardMetric label="待复核" value={metrics.reviewTasks} />
          <BoardMetric label="待签批" value={metrics.approvalTasks + metrics.pendingApprovalMeetings} />
        </section>

        <section className={`${styles.card} ${styles.boardStatusCard}`}>
          <div className={styles.sectionHeaderCompact}>
            <h2 className={styles.sectionTitle}>状态分布</h2>
            <Tag tone={riskCount > 0 ? "risk" : "success"}>{riskCount > 0 ? `${riskCount} 个风险` : "正常"}</Tag>
          </div>
          <div className={styles.boardStatusList}>
            <StatusItem icon={<Clock3 size={16} aria-hidden="true" />} label="云端精修中" value={metrics.transcribingMeetings} tone="wait" />
            <StatusItem icon={<FileText size={16} aria-hidden="true" />} label="待提交/确认" value={metrics.pendingMinutes} tone="wait" />
            <StatusItem icon={<CheckSquare size={16} aria-hidden="true" />} label="会议待办" value={metrics.activeMeetingTasks} />
            <StatusItem icon={<AlertTriangle size={16} aria-hidden="true" />} label="异常/逾期" value={riskCount} tone={riskCount > 0 ? "risk" : "success"} />
          </div>
        </section>

        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>需要关注</h2>
          <Tag tone="navy">{attentionMeetings.length}</Tag>
        </div>
        <section className={styles.recentList}>
          {attentionMeetings.length ? (
            attentionMeetings.map((meeting) => (
              <button className={styles.wideButton} type="button" key={meeting.id} onClick={() => onOpenMeeting(meeting.id)}>
                <div className={styles.buttonRow}>
                  <div className={styles.clip}>
                    <h3 className={styles.cardTitle}>{meeting.title}</h3>
                    <p className={styles.smallText}>{meeting.meta}</p>
                  </div>
                  <Tag tone={meeting.tone}>{meeting.status}</Tag>
                </div>
              </button>
            ))
          ) : (
            <div className={`${styles.card} ${styles.emptyCard}`}>当前没有需要优先关注的会议。</div>
          )}
        </section>
      </div>
    </div>
  );
}
