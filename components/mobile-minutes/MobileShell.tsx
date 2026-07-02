import { type ReactNode } from "react";
import styles from "./MobileMinutes.module.css";

export function MobileShell({ children }: { children: ReactNode }) {
  return (
    <main className={styles.page}>
      <section className={styles.phone}>
        {children}
      </section>
    </main>
  );
}

export function Tag({ children, tone = "normal" }: { children: ReactNode; tone?: string }) {
  const toneClass =
    tone === "success"
      ? styles.toneSuccess
      : tone === "risk"
        ? styles.toneRisk
        : tone === "wait"
          ? styles.toneWait
          : tone === "navy"
            ? styles.toneNavy
            : styles.toneNormal;

  return <span className={`${styles.tag} ${toneClass}`}>{children}</span>;
}

export function AppHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header className={styles.header}>
      <div className={styles.headerRow}>
        <h1 className={styles.title}>{title}</h1>
        {right ? <div>{right}</div> : null}
      </div>
    </header>
  );
}
