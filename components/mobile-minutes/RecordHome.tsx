import { type ReactNode, useMemo, useState } from "react";
import { BarChart3, ChevronDown, ChevronUp, Grid2X2, Mic, Plus, Trash2, Users } from "lucide-react";
import { AppHeader, Tag } from "./MobileShell";
import type { MobileBackendEntry, MobileBackendPage, MobileManagementMetrics, MobileMinuteCard } from "./mobileMinutesTypes";
import styles from "./MobileMinutes.module.css";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <p className={styles.metricLabel}>{label}</p>
      <p className={styles.metricValue}>{value}</p>
    </div>
  );
}

function ActionMetric({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return (
    <button className={`${styles.metric} ${styles.metricAction}`} type="button" onClick={onClick}>
      <p className={styles.metricLabel}>{label}</p>
      <p className={styles.metricValue}>
        <Plus size={18} aria-hidden="true" />
        {value}
      </p>
    </button>
  );
}

export function RecordHome({
  onStartRecording,
  onOpenDetail,
  onDeleteMinute,
  onOpenManagement,
  onOpenParticipants,
  onOpenBackendEntry,
  recentMinutes,
  metrics,
  managementMetrics,
  backendEntries = [],
  participantNames,
  connectionStatus
}: {
  onStartRecording: () => void;
  onOpenDetail: (meetingId?: string) => void;
  onDeleteMinute?: (meetingId: string) => void | Promise<void>;
  onOpenManagement?: () => void;
  onOpenParticipants?: () => void;
  onOpenBackendEntry?: (page: MobileBackendPage) => void;
  recentMinutes: MobileMinuteCard[];
  metrics: { todayMeetings: number; pendingMinutes: number; activeTasks: number };
  managementMetrics?: MobileManagementMetrics;
  backendEntries?: MobileBackendEntry[];
  participantNames?: string[];
  connectionStatus?: ReactNode;
}) {
  const [recentCollapsed, setRecentCollapsed] = useState(true);
  const visibleRecentMinutes = useMemo(() => (recentCollapsed ? recentMinutes.slice(0, 1) : recentMinutes), [recentCollapsed, recentMinutes]);
  const selectedParticipantNames = participantNames ?? [];
  const participantCount = selectedParticipantNames.length;
  const participantSummary = participantCount ? selectedParticipantNames.slice(0, 4).join("、") : "登录后自动带入录音人";
  const showParticipantEntry = Boolean(onOpenParticipants);

  return (
    <div className={styles.content}>
      <AppHeader title="AI 会议记录" right={connectionStatus} />
      <div className={styles.sectionPad}>
        <section className={`${styles.card} ${styles.recordCard}`}>
          <div className={styles.buttonRow}>
            <Tag>未录音</Tag>
            <span className={styles.smallText}>内部会议可用</span>
          </div>
          <div className={styles.recordButtonWrap}>
            <button className={styles.recordButton} type="button" aria-label="开始会议记录" onClick={onStartRecording}>
              <Mic size={48} aria-hidden="true" />
            </button>
            <p className={styles.recordTitle}>开始记录</p>
            <p className={styles.recordSub}>实时记录，会后生成纪要与待办</p>
          </div>
        </section>

        <section className={styles.metrics} aria-label="今日会议概览">
          <Metric label="今日会议" value={String(metrics.todayMeetings)} />
          <ActionMetric label="新建会议" value="新建" onClick={() => onOpenBackendEntry?.("new-meeting")} />
          <Metric label="待确认" value={String(metrics.pendingMinutes)} />
          <Metric label="待办" value={String(metrics.activeTasks)} />
        </section>

        {showParticipantEntry ? (
          <button className={`${styles.wideButton} ${styles.participantEntry}`} type="button" onClick={onOpenParticipants}>
            <div className={styles.buttonRow}>
              <div className={styles.managementEntryIcon}>
                <Users size={20} aria-hidden="true" />
              </div>
              <div className={styles.clip}>
                <h2 className={styles.cardTitle}>会议人员</h2>
                <p className={styles.smallText}>{participantSummary}{participantCount > 4 ? ` 等 ${participantCount} 人` : ""}</p>
              </div>
              <Tag tone="navy">{participantCount} 人</Tag>
            </div>
          </button>
        ) : null}

        {managementMetrics ? (
          <button className={`${styles.wideButton} ${styles.managementEntry}`} type="button" onClick={onOpenManagement}>
            <div className={styles.buttonRow}>
              <div className={styles.managementEntryIcon}>
                <BarChart3 size={20} aria-hidden="true" />
              </div>
              <div className={styles.clip}>
                <h2 className={styles.cardTitle}>管理驾驶舱</h2>
                <p className={styles.smallText}>
                  {managementMetrics.scopeLabel} · {managementMetrics.totalMeetings} 场会议 · {managementMetrics.activeMeetingTasks} 个会议待办
                </p>
              </div>
              <Tag tone={managementMetrics.failedMeetings + managementMetrics.overdueTasks > 0 ? "risk" : "navy"}>
                {managementMetrics.failedMeetings + managementMetrics.overdueTasks > 0 ? "需关注" : "查看"}
              </Tag>
            </div>
          </button>
        ) : null}

        {backendEntries.length ? (
          <section className={styles.backendEntrySection} aria-label="后台功能">
            <div className={styles.sectionHeaderCompact}>
              <h2 className={styles.sectionTitle}>后台功能</h2>
              <Tag tone="navy">{backendEntries.length}</Tag>
            </div>
            <div className={styles.backendEntryGrid}>
              {backendEntries.map((entry) => (
                <button className={styles.backendEntryCard} type="button" key={entry.id} onClick={() => onOpenBackendEntry?.(entry.id)}>
                  <span className={styles.backendEntryIcon}><Grid2X2 size={18} aria-hidden="true" /></span>
                  <span className={styles.backendEntryText}>
                    <b>{entry.title}</b>
                    <small>{entry.description}</small>
                  </span>
                  <Tag tone={entry.tone}>{entry.status}</Tag>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>最近妙记</h2>
          {recentMinutes.length > 1 ? (
            <button className={styles.textIconButton} type="button" onClick={() => setRecentCollapsed((value) => !value)}>
              {recentCollapsed ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
              {recentCollapsed ? `展开 ${recentMinutes.length}` : "收起"}
            </button>
          ) : null}
        </div>
        <div className={styles.recentList}>
          {recentMinutes.length > 0 ? (
            visibleRecentMinutes.map((item) => (
              <article className={`${styles.wideButton} ${styles.minuteRow}`} key={item.id}>
                <button className={styles.minuteOpenButton} type="button" disabled={item.isPending} onClick={() => onOpenDetail(item.id)}>
                  <div className={styles.buttonRow}>
                    <div className={styles.clip}>
                      <h3 className={styles.cardTitle}>{item.title}</h3>
                      <p className={styles.smallText}>{item.meta}</p>
                    </div>
                    <Tag tone={item.tone}>{item.status}</Tag>
                  </div>
                </button>
                {item.isPending ? (
                  <div className={styles.iconButtonPlaceholder} aria-hidden="true" />
                ) : (
                  <button className={styles.iconButtonSmall} type="button" title="删除妙记" aria-label={`删除 ${item.title}`} onClick={() => onDeleteMinute?.(item.id)}>
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                )}
              </article>
            ))
          ) : (
            <button className={styles.wideButton} type="button" onClick={() => onOpenDetail()}>
              <div className={styles.buttonRow}>
                <div className={styles.clip}>
                  <h3 className={styles.cardTitle}>暂无后端会议</h3>
                  <p className={styles.smallText}>可先开始记录，结束后进入妙记详情。</p>
                </div>
                <Tag tone="normal">演示</Tag>
              </div>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
