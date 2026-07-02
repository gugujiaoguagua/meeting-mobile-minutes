import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ASR_ENDPOINT = "asr.tencentcloudapi.com";
const ASR_SERVICE = "asr";
const ASR_VERSION = "2019-06-14";
const MAX_LOCAL_AUDIO_BYTES = 5 * 1024 * 1024;
const SUPPORTED_LOCAL_EXTENSIONS = new Set([".wav", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".amr"]);

export type TencentAsrResult =
  | {
      status: "success";
      provider: "tencent";
      taskId: number;
      transcript: string;
      audioDuration?: number;
      requestId?: string;
    }
  | {
      status: "pending";
      provider: "tencent";
      taskId: number;
      message: string;
      requestId?: string;
    }
  | {
      status: "skipped" | "failed";
      provider: "tencent";
      message: string;
      requestId?: string;
    };

type TencentAsrConfig = {
  secretId: string;
  secretKey: string;
  region: string;
  engineModelType: string;
  resTextFormat: number;
  channelNum: number;
  pollTimeoutMs: number;
  pollIntervalMs: number;
};

type TencentApiError = {
  Code?: string;
  Message?: string;
};

type TencentApiResponse<T> = {
  Response?: T & {
    Error?: TencentApiError;
    RequestId?: string;
  };
};

type CreateRecTaskResponse = {
  Data?: {
    TaskId?: number;
  };
};

type DescribeTaskStatusResponse = {
  Data?: {
    TaskId?: number;
    Status?: number;
    StatusStr?: string;
    AudioDuration?: number;
    Result?: string;
    ErrorMsg?: string;
    ResultDetail?: Array<{
      FinalSentence?: string;
      SliceSentence?: string;
    }>;
  };
};

function envValue(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function numberEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function isTencentAsrConfigured() {
  return Boolean(envValue("TENCENTCLOUD_SECRET_ID", "TENCENT_SECRET_ID") && envValue("TENCENTCLOUD_SECRET_KEY", "TENCENT_SECRET_KEY"));
}

function getConfig(): TencentAsrConfig | undefined {
  const secretId = envValue("TENCENTCLOUD_SECRET_ID", "TENCENT_SECRET_ID");
  const secretKey = envValue("TENCENTCLOUD_SECRET_KEY", "TENCENT_SECRET_KEY");
  if (!secretId || !secretKey) return undefined;

  return {
    secretId,
    secretKey,
    region: envValue("TENCENTCLOUD_REGION", "TENCENT_REGION") || "ap-guangzhou",
    engineModelType: envValue("TENCENT_ASR_ENGINE_MODEL_TYPE") || "16k_zh",
    resTextFormat: numberEnv("TENCENT_ASR_RES_TEXT_FORMAT", 3),
    channelNum: numberEnv("TENCENT_ASR_CHANNEL_NUM", 1),
    pollTimeoutMs: numberEnv("TENCENT_ASR_POLL_TIMEOUT_MS", 45_000),
    pollIntervalMs: numberEnv("TENCENT_ASR_POLL_INTERVAL_MS", 2_000)
  };
}

function sha256(message: string) {
  return createHash("sha256").update(message, "utf8").digest("hex");
}

function hmacBuffer(key: string | Buffer, message: string) {
  return createHmac("sha256", key).update(message, "utf8").digest();
}

function hmacHex(key: string | Buffer, message: string) {
  return createHmac("sha256", key).update(message, "utf8").digest("hex");
}

async function callTencentAsr<T>(config: TencentAsrConfig, action: string, payload: Record<string, unknown>) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = "application/json; charset=utf-8";
  const payloadString = JSON.stringify(payload);
  const canonicalHeaders = `content-type:${contentType}\nhost:${ASR_ENDPOINT}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256(payloadString)].join("\n");
  const credentialScope = `${date}/${ASR_SERVICE}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", timestamp, credentialScope, sha256(canonicalRequest)].join("\n");
  const secretDate = hmacBuffer(`TC3${config.secretKey}`, date);
  const secretService = hmacBuffer(secretDate, ASR_SERVICE);
  const secretSigning = hmacBuffer(secretService, "tc3_request");
  const signature = hmacHex(secretSigning, stringToSign);
  const authorization = `TC3-HMAC-SHA256 Credential=${config.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`https://${ASR_ENDPOINT}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": contentType,
      Host: ASR_ENDPOINT,
      "X-TC-Action": action,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": ASR_VERSION,
      "X-TC-Region": config.region
    },
    body: payloadString
  });
  const body = (await response.json()) as TencentApiResponse<T>;
  const error = body.Response?.Error;
  if (error) {
    const message = error.Message ? `${error.Code}: ${error.Message}` : error.Code || "Tencent ASR request failed";
    throw new Error(message);
  }
  return body.Response;
}

function normalizeTencentResult(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function transcriptFromResult(data: DescribeTaskStatusResponse["Data"]) {
  const detailText = data?.ResultDetail?.map((item) => item.FinalSentence || item.SliceSentence || "")
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (detailText) return detailText;
  return normalizeTencentResult(data?.Result || "");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function needsTranscode(filePath: string, mimeType: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".webm" || mimeType.includes("webm")) return true;
  return !SUPPORTED_LOCAL_EXTENSIONS.has(ext);
}

async function transcodeForTencentAsr(inputPath: string, mimeType: string) {
  if (!needsTranscode(inputPath, mimeType)) return inputPath;

  const outputDir = path.join(path.dirname(inputPath), "_asr");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}.mp3`);
  const ffmpegPath = envValue("FFMPEG_PATH") || "ffmpeg";
  await execFileAsync(ffmpegPath, ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", outputPath], {
    windowsHide: true,
    timeout: numberEnv("TENCENT_ASR_TRANSCODE_TIMEOUT_MS", 60_000)
  });
  return outputPath;
}

export async function transcribeAudioWithTencentAsr(input: { filePath: string; mimeType: string }): Promise<TencentAsrResult> {
  const config = getConfig();
  if (!config) {
    return { status: "skipped", provider: "tencent", message: "Tencent ASR credentials are not configured." };
  }

  try {
    const audioPath = await transcodeForTencentAsr(input.filePath, input.mimeType);
    const audioStats = await stat(audioPath);
    if (audioStats.size > MAX_LOCAL_AUDIO_BYTES) {
      return {
        status: "skipped",
        provider: "tencent",
        message: `Audio file is ${(audioStats.size / 1024 / 1024).toFixed(1)}MB after conversion, exceeding Tencent ASR local upload limit.`
      };
    }

    const audioBuffer = await readFile(audioPath);
    const created = await callTencentAsr<CreateRecTaskResponse>(config, "CreateRecTask", {
      EngineModelType: config.engineModelType,
      ChannelNum: config.channelNum,
      ResTextFormat: config.resTextFormat,
      SourceType: 1,
      Data: audioBuffer.toString("base64"),
      DataLen: audioBuffer.length
    });
    const taskId = created?.Data?.TaskId;
    if (!taskId) {
      return { status: "failed", provider: "tencent", message: "Tencent ASR did not return a task id.", requestId: created?.RequestId };
    }

    const deadline = Date.now() + config.pollTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(config.pollIntervalMs);
      const status = await callTencentAsr<DescribeTaskStatusResponse>(config, "DescribeTaskStatus", { TaskId: taskId });
      const data = status?.Data;
      if (data?.Status === 2 || data?.StatusStr === "success") {
        const transcript = transcriptFromResult(data);
        if (!transcript) {
          return { status: "failed", provider: "tencent", message: "Tencent ASR completed but returned empty transcript.", requestId: status?.RequestId };
        }
        return {
          status: "success",
          provider: "tencent",
          taskId,
          transcript,
          audioDuration: data.AudioDuration,
          requestId: status?.RequestId
        };
      }
      if (data?.Status === 3 || data?.StatusStr === "failed") {
        return {
          status: "failed",
          provider: "tencent",
          message: data.ErrorMsg || "Tencent ASR task failed.",
          requestId: status?.RequestId
        };
      }
    }

    return {
      status: "pending",
      provider: "tencent",
      taskId,
      message: "Tencent ASR task was submitted but did not finish within the request timeout.",
      requestId: created?.RequestId
    };
  } catch (error) {
    return {
      status: "failed",
      provider: "tencent",
      message: error instanceof Error ? error.message : "Tencent ASR transcription failed."
    };
  }
}
