import { useMemo, useState } from "react";
import { Bell, Filter } from "lucide-react";
import type { MobileMessage } from "./mobileMinutesTypes";
import { sampleMessages } from "./mobileMinutesMock";
import { AppHeader, Tag } from "./MobileShell";
import styles from "./MobileMinutes.module.css";

type MessageFilter = "all" | "unread" | "read" | "task";

export function MobileMessages({
  messages = sampleMessages,
  onMarkRead,
  onMarkAllRead,
  onOpenTask
}: {
  messages?: MobileMessage[];
  onMarkRead?: (messageId: string) => void;
  onMarkAllRead?: () => void;
  onOpenTask?: (message: MobileMessage) => void;
}) {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filter, setFilter] = useState<MessageFilter>("all");
  const unreadCount = messages.filter((message) => !message.isRead).length;
  const displayMessages = useMemo(() => {
    const filtered = messages.filter((message) => {
      if (filter === "unread") return !message.isRead;
      if (filter === "read") return message.isRead;
      if (filter === "task") return Boolean(message.taskId);
      return true;
    });

    return filtered
      .map((message, index) => ({ message, index }))
      .sort((a, b) => {
        if (a.message.isRead !== b.message.isRead) return a.message.isRead ? 1 : -1;
        if (a.message.sortTime !== b.message.sortTime) return (b.message.sortTime ?? 0) - (a.message.sortTime ?? 0);
        return a.index - b.index;
      })
      .map(({ message }) => message);
  }, [filter, messages]);

  const filterOptions: Array<[MessageFilter, string]> = [
    ["all", "全部"],
    ["unread", "未读"],
    ["read", "已读"],
    ["task", "待办"]
  ];

  return (
    <div className={styles.content}>
      <AppHeader
        title="消息"
        right={
          <div className={styles.headerActions}>
            <button
              className={`${styles.iconButton} ${isFilterOpen ? styles.iconButtonActive : ""}`}
              type="button"
              aria-label="筛选消息"
              aria-expanded={isFilterOpen}
              onClick={() => setIsFilterOpen((current) => !current)}
            >
              <Filter size={18} aria-hidden="true" />
            </button>
          </div>
        }
      />
      <div className={styles.sectionPad}>
        <div className={styles.listToolbar}>
          <span>{unreadCount > 0 ? `未读 ${unreadCount} 条` : "消息已全部处理"}</span>
          <button className={styles.textButton} type="button" onClick={onMarkAllRead} disabled={!unreadCount}>
            全部已读
          </button>
        </div>
        {isFilterOpen ? (
          <div className={styles.filterBar} role="tablist" aria-label="消息筛选">
            {filterOptions.map(([id, label]) => (
              <button
                className={filter === id ? styles.filterChipActive : styles.filterChip}
                key={id}
                type="button"
                role="tab"
                aria-selected={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <section className={styles.messageList}>
          {displayMessages.length === 0 ? <div className={`${styles.card} ${styles.emptyCard}`}>当前筛选没有消息。</div> : null}
          {displayMessages.map((message) => (
            <article className={`${styles.card} ${styles.messageCard} ${message.isRead ? styles.readCard : ""}`} key={message.id}>
              <div className={styles.messageIcon}>
                <Bell size={18} aria-hidden="true" />
              </div>
              <div className={styles.clip}>
                <div className={styles.messageHead}>
                  <div className={styles.messageTitleWrap}>
                    {!message.isRead ? <span className={styles.unreadDot} aria-label="未读" /> : null}
                    <Tag tone={message.tone}>{message.title}</Tag>
                  </div>
                  <span className={styles.smallText}>{message.time}</span>
                </div>
                <h2 className={styles.cardTitle}>{message.source}</h2>
                <p className={styles.messageBody}>{message.body}</p>
                <div className={`${styles.inlineActions} ${styles.messageActions}`}>
                  <button className={styles.smallButton} type="button" onClick={() => onOpenTask?.(message)}>
                    {message.taskId ? "查看待办" : message.actionLabel}
                  </button>
                  {!message.isRead ? (
                    <button className={styles.ghostButton} type="button" onClick={() => onMarkRead?.(message.id)}>
                      标为已读
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
