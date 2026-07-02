import { FileText, Square } from "lucide-react";
import { Tag } from "./MobileShell";
import { sampleTranscript } from "./mobileMinutesMock";
import styles from "./MobileMinutes.module.css";

function waveHeight(index: number) {
  return 18 + ((index * 19) % 62);
}

export function RecordingPanel({
  elapsedTime,
  onEndRecording,
  transcriptLines = [],
  status = "recording",
  message = ""
}: {
  elapsedTime: string;
  onEndRecording: () => void;
  transcriptLines?: string[];
  status?: "requesting" | "recording" | "uploading" | "error";
  message?: string;
}) {
  const displayLines = transcriptLines.length
    ? transcriptLines.map((text, index) => ({ time: elapsedTime, speaker: `发言人${Math.min((index % 3) + 1, 3)}`, text }))
    : sampleTranscript;

  return (
    <div className={styles.recordingWrap}>
      <div className={styles.recordingTop}>
        <h1 className={styles.title}>AI 会议记录</h1>
        <Tag tone={status === "uploading" ? "wait" : status === "error" ? "risk" : "risk"}>{status === "uploading" ? "上传中" : status === "requesting" ? "授权中" : "录音中"}</Tag>
      </div>

      <section className={styles.recordingPanel}>
        <p className={styles.recordingMeta}>产品周会 / 移动端闭环</p>
        <div className={styles.timer}>{elapsedTime}</div>
        {message ? <p className={styles.recordingMeta}>{message}</p> : null}
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
        <div className={styles.transcriptList}>
          {displayLines.map((item, index) => (
            <article className={styles.transcriptItem} key={`${item.time}-${item.speaker}-${index}`}>
              <p className={styles.transcriptMeta}>
                {item.time} · {item.speaker}
              </p>
              <p className={styles.transcriptText}>{item.text}</p>
            </article>
          ))}
        </div>
        <div className={styles.fadeDown} />
      </section>

      <button className={styles.endButton} type="button" onClick={onEndRecording} disabled={status === "uploading" || status === "requesting"}>
        <Square size={17} fill="currentColor" aria-hidden="true" />
        {status === "uploading" ? "正在上传录音" : "结束并查看妙记"}
      </button>
    </div>
  );
}
