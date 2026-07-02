import { FileText, Square } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Tag } from "./MobileShell";
import type { TranscriptLine } from "./mobileMinutesTypes";
import styles from "./MobileMinutes.module.css";

function waveHeight(index: number) {
  return 18 + ((index * 19) % 62);
}

export function RecordingPanel({
  elapsedTime,
  onEndRecording,
  transcriptLines = [],
  status = "recording",
  message = "",
  uploadElapsedTime = ""
}: {
  elapsedTime: string;
  onEndRecording: () => void;
  transcriptLines?: TranscriptLine[];
  status?: "requesting" | "recording" | "uploading" | "error";
  message?: string;
  uploadElapsedTime?: string;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const displayLines = useMemo(
    () => transcriptLines.map((line, index) => ({ ...line, speaker: line.speaker || `发言人${Math.min((index % 3) + 1, 3)}` })),
    [transcriptLines]
  );
  const statusText = status === "uploading" ? "上传中" : status === "requesting" ? "授权中" : status === "error" ? "失败" : "录音中";
  const emptyText = status === "uploading" ? "录音已结束，正在上传并等待云端转写结果。" : "当前浏览器未返回实时转写，结束录音后会生成云端转写。";
  const uploadText = uploadElapsedTime ? `已等待 ${uploadElapsedTime}` : "";

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [displayLines.length, displayLines.at(-1)?.text]);

  return (
    <div className={styles.recordingWrap}>
      <div className={styles.recordingTop}>
        <h1 className={styles.title}>AI 会议记录</h1>
        <Tag tone={status === "uploading" ? "wait" : status === "error" ? "risk" : "risk"}>{statusText}</Tag>
      </div>

      <section className={styles.recordingPanel}>
        <p className={styles.recordingMeta}>产品周会 / 移动端闭环</p>
        <div className={styles.timer}>{elapsedTime}</div>
        {message ? <p className={styles.recordingMeta}>{message}</p> : null}
        {status === "uploading" && uploadText ? <p className={styles.recordingMeta}>{uploadText}</p> : null}
        <div className={styles.wave} aria-hidden="true">
          {Array.from({ length: 30 }).map((_, index) => (
            <span className={styles.bar} key={index} style={{ height: `${waveHeight(index)}px` }} />
          ))}
        </div>
      </section>

      <section className={`${styles.card} ${styles.transcriptPanel}`}>
        <div className={styles.transcriptHeader}>
          <div className={styles.transcriptTitle}>
            <FileText size={17} aria-hidden="true" />
            AI 实时记录
          </div>
          <span className={styles.smallText}>自动滚动</span>
        </div>
        <div className={styles.transcriptList} ref={listRef}>
          {displayLines.length > 0 ? (
            displayLines.map((item, index) => (
              <article className={styles.transcriptItem} key={`${item.time}-${item.speaker}-${index}`}>
                <p className={styles.transcriptMeta}>
                  {item.time} · {item.speaker}
                </p>
                <p className={styles.transcriptText}>{item.text}</p>
              </article>
            ))
          ) : (
            <article className={`${styles.transcriptItem} ${styles.emptyCard}`}>
              <p className={styles.transcriptText}>{emptyText}</p>
            </article>
          )}
        </div>
        <div className={styles.fadeDown} />
      </section>

      <button className={styles.endButton} type="button" onClick={onEndRecording} disabled={status === "uploading" || status === "requesting"}>
        <Square size={17} fill="currentColor" aria-hidden="true" />
        {status === "uploading" ? `上传并转写中${uploadElapsedTime ? ` ${uploadElapsedTime}` : ""}` : "结束并查看妙记"}
      </button>
    </div>
  );
}
