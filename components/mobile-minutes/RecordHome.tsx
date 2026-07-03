import { type ReactNode, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Mic, Trash2 } from "lucide-react";
import { AppHeader, Tag } from "./MobileShell";
import type { MobileMinuteCard } from "./mobileMinutesTypes";
import styles from "./MobileMinutes.module.css";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <p className={styles.metricLabel}>{label}</p>
      <p className={styles.metricValue}>{value}</p>
    </div>
  );
}

export function RecordHome({
  onStartRecording,
  onOpenDetail,
  onDeleteMinute,
  recentMinutes,
  metrics,
  connectionStatus
}: {
  onStartRecording: () => void;
  onOpenDetail: (meetingId?: string) => void;
  onDeleteMinute?: (meetingId: string) => void | Promise<void>;
  recentMinutes: MobileMinuteCard[];
  metrics: { todayMeetings: number; pendingMinutes: number; activeTasks: number };
  connectionStatus?: ReactNode;
}) {
  const [recentCollapsed, setRecentCollapsed] = useState(true);
  const visibleRecentMinutes = useMemo(() => (recentCollapsed ? recentMinutes.slice(0, 1) : recentMinutes), [recentCollapsed, recentMinutes]);

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
          <Metric label="待确认" value={String(metrics.pendingMinutes)} />
          <Metric label="待办" value={String(metrics.activeTasks)} />
        </section>

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
                <button className={styles.minuteOpenButton} type="button" onClick={() => onOpenDetail(item.id)}>
                  <div className={styles.buttonRow}>
                    <div className={styles.clip}>
                      <h3 className={styles.cardTitle}>{item.title}</h3>
                      <p className={styles.smallText}>{item.meta}</p>
                    </div>
                    <Tag tone={item.tone}>{item.status}</Tag>
                  </div>
                </button>
                <button className={styles.iconButtonSmall} type="button" title="删除妙记" aria-label={`删除 ${item.title}`} onClick={() => onDeleteMinute?.(item.id)}>
                  <Trash2 size={16} aria-hidden="true" />
                </button>
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
