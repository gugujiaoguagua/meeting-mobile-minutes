import { CheckSquare, Home, Inbox, User } from "lucide-react";
import type { MainTab } from "./mobileMinutesTypes";
import styles from "./MobileMinutes.module.css";

const navItems = [
  { id: "record" as const, label: "记录", Icon: Home },
  { id: "messages" as const, label: "消息", Icon: Inbox },
  { id: "tasks" as const, label: "待办", Icon: CheckSquare },
  { id: "me" as const, label: "我的", Icon: User }
];

export function BottomNav({
  activeTab,
  onChange,
  unreadMessageCount = 0
}: {
  activeTab: MainTab;
  onChange: (tab: MainTab) => void;
  unreadMessageCount?: number;
}) {
  return (
    <nav className={styles.bottomNav} aria-label="手机端主导航">
      {navItems.map(({ id, label, Icon }) => {
        const hasUnread = id === "messages" && unreadMessageCount > 0;
        return (
          <button
            key={id}
            className={`${styles.navButton} ${activeTab === id ? styles.navButtonActive : ""}`}
            type="button"
            onClick={() => onChange(id)}
            aria-current={activeTab === id ? "page" : undefined}
          >
            <span className={styles.navIconWrap}>
              <Icon size={22} aria-hidden="true" />
              {hasUnread ? <span className={styles.navUnreadDot} aria-label={`${unreadMessageCount} 条未读消息`} /> : null}
            </span>
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
