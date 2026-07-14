import { useMemo, useState } from "react";
import { CheckCircle2, Search, X } from "lucide-react";
import type { Department, User } from "@/lib/types";
import styles from "./MobileMinutes.module.css";

function participantSearchText(user: User, department?: Department) {
  return [user.name, user.title, user.role, user.employeeNo, department?.name, department?.fullPath].filter(Boolean).join(" ").toLowerCase();
}

function userMeta(user: User, department?: Department) {
  return [department?.name, user.title || user.role, user.employeeNo].filter(Boolean).join(" · ");
}

export function ParticipantPickerSheet({
  currentUserId,
  departments,
  selectedIds,
  users,
  onClose,
  onConfirm
}: {
  currentUserId?: string;
  departments: Department[];
  selectedIds: string[];
  users: User[];
  onClose: () => void;
  onConfirm: (participantIds: string[]) => void;
}) {
  const requiredIds = useMemo(() => new Set([currentUserId].filter((value): value is string => Boolean(value))), [currentUserId]);
  const hasCurrentUser = requiredIds.size > 0;
  const [draftIds, setDraftIds] = useState(() => [...new Set([...requiredIds, ...selectedIds])]);
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(draftIds), [draftIds]);
  const options = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
      ? users.filter((user) => {
          const department = departments.find((item) => item.id === user.departmentId);
          return participantSearchText(user, department).includes(normalizedQuery);
        })
      : users;
    return filtered.slice(0, 60);
  }, [departments, query, users]);

  function toggleUser(userId: string) {
    if (requiredIds.has(userId)) return;
    setDraftIds((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]));
  }

  function confirm() {
    onConfirm([...new Set([...requiredIds, ...draftIds])]);
  }

  return (
    <div className={styles.assignmentOverlay} role="dialog" aria-modal="true" aria-labelledby="participant-picker-title">
      <div className={styles.assignmentSheet}>
        <div className={styles.assignmentHeader}>
          <div>
            <p className={styles.assignmentEyebrow}>会议人员</p>
            <h2 className={styles.assignmentTitle} id="participant-picker-title">选择本次参会人员</h2>
            <p className={styles.smallText}>{hasCurrentUser ? "当前登录人默认参会，其他人员用于后续发言人标注和 AI 纪要上下文。" : "登录后会自动带入录音人，其他人员用于后续发言人标注和 AI 纪要上下文。"}</p>
          </div>
          <button className={styles.iconButton} type="button" aria-label="关闭会议人员选择" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <label className={styles.assignmentSearch}>
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名 / 岗位 / 工号 / 部门" />
        </label>

        <div className={styles.participantSelectedBar}>
          <span>已选 {draftIds.length} 人</span>
          <span>{draftIds.map((id) => users.find((user) => user.id === id)?.name).filter(Boolean).slice(0, 4).join("、") || "暂无"}</span>
        </div>

        <div className={styles.assignmentList}>
          {options.length ? (
            options.map((user) => {
              const department = departments.find((item) => item.id === user.departmentId);
              const selected = selectedSet.has(user.id);
              const required = requiredIds.has(user.id);
              return (
                <button
                  className={`${styles.assignmentOption} ${selected ? styles.assignmentOptionActive : ""}`}
                  type="button"
                  key={user.id}
                  onClick={() => toggleUser(user.id)}
                  aria-pressed={selected}
                >
                  <span className={styles.assignmentOptionName}>{user.name}{required ? " / 录音人" : ""}</span>
                  <span className={styles.assignmentOptionMeta}>{userMeta(user, department)}</span>
                  {selected ? <CheckCircle2 size={17} aria-hidden="true" /> : null}
                </button>
              );
            })
          ) : (
            <div className={`${styles.card} ${styles.emptyCard}`}>没有匹配人员。</div>
          )}
        </div>

        <div className={styles.participantPickerFooter}>
          <button className={styles.secondaryButton} type="button" onClick={onClose}>取消</button>
          <button className={styles.primaryButton} type="button" onClick={confirm}>确定 {draftIds.length} 人</button>
        </div>
      </div>
    </div>
  );
}
