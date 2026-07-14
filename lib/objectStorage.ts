import { createHmac } from "node:crypto";

export type StoragePutInput = {
  key: string;
  body: string | Buffer;
  mimeType?: string;
  metadata?: Record<string, string>;
};

export type StorageObjectRef = {
  provider: "oss";
  bucket: string;
  region: string;
  endpoint: string;
  key: string;
  sizeBytes?: number;
  mimeType?: string;
};

type OssConfig = {
  region: string;
  endpoint: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  accessKeySecret: string;
  signedUrlTtlSeconds: number;
  requestTimeoutMs: number;
};

function optionalEnv(name: string) {
  return process.env[name]?.trim() || "";
}

function normalizePrefix(value: string) {
  return value.replace(/^\/+|\/+$/g, "");
}

function normalizeEndpoint(value: string, bucket?: string) {
  let endpoint = value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
  if (bucket && endpoint.startsWith(`${bucket}.`)) endpoint = endpoint.slice(bucket.length + 1);
  return endpoint;
}

function getOssConfig(): OssConfig {
  const region = optionalEnv("MEETING_OSS_REGION") || optionalEnv("OSS_REGION");
  const bucket = optionalEnv("MEETING_OSS_BUCKET") || optionalEnv("OSS_BUCKET");
  const endpoint = normalizeEndpoint(optionalEnv("MEETING_OSS_ENDPOINT") || optionalEnv("OSS_ENDPOINT"), bucket);
  const prefix = normalizePrefix(optionalEnv("MEETING_OSS_PREFIX") || optionalEnv("OSS_PREFIX"));
  const accessKeyId = optionalEnv("MEETING_OSS_ACCESS_KEY_ID") || optionalEnv("OSS_ACCESS_KEY_ID");
  const accessKeySecret = optionalEnv("MEETING_OSS_ACCESS_KEY_SECRET") || optionalEnv("OSS_ACCESS_KEY_SECRET");
  const signedUrlTtlSeconds = Number.parseInt(optionalEnv("MEETING_OSS_SIGNED_URL_TTL_SECONDS") || "7200", 10);
  const requestTimeoutMs = Number.parseInt(optionalEnv("MEETING_OSS_REQUEST_TIMEOUT_MS") || "300000", 10);

  return {
    region,
    endpoint,
    bucket,
    prefix,
    accessKeyId,
    accessKeySecret,
    signedUrlTtlSeconds: Number.isFinite(signedUrlTtlSeconds) && signedUrlTtlSeconds > 0 ? signedUrlTtlSeconds : 7200,
    requestTimeoutMs: Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0 ? requestTimeoutMs : 300000
  };
}

export function getObjectStoragePublicConfig() {
  const config = getOssConfig();
  return {
    provider: "oss" as const,
    enabled: isObjectStorageEnabled(),
    configured: isObjectStorageConfigured(),
    bucket: config.bucket,
    region: config.region,
    endpoint: config.endpoint,
    prefix: config.prefix
  };
}

export function isObjectStorageEnabled() {
  return optionalEnv("MEETING_OBJECT_STORAGE").toLowerCase() === "oss";
}

export function isObjectStorageConfigured() {
  const config = getOssConfig();
  return Boolean(config.region && config.endpoint && config.bucket && config.prefix && config.accessKeyId && config.accessKeySecret);
}

function requireConfig() {
  const config = getOssConfig();
  if (!isObjectStorageEnabled()) throw new Error("MEETING_OBJECT_STORAGE is not set to oss.");
  if (!isObjectStorageConfigured()) throw new Error("Aliyun OSS object storage is not fully configured.");
  return config;
}

function sanitizeKeyPart(part: string) {
  const trimmed = part.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!trimmed || trimmed === "." || trimmed === ".." || trimmed.includes("../") || trimmed.includes("..\\")) {
    throw new Error("Invalid object key part.");
  }
  return trimmed;
}

export function meetingObjectKey(parts: string[]) {
  const config = getOssConfig();
  const prefix = normalizePrefix(config.prefix);
  if (!prefix) throw new Error("MEETING_OSS_PREFIX is required.");
  const suffix = parts.map(sanitizeKeyPart).join("/");
  const key = `${prefix}/${suffix}`;
  assertMeetingObjectKey(key, config);
  return key;
}

function assertMeetingObjectKey(key: string, config = getOssConfig()) {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
  const prefix = normalizePrefix(config.prefix);
  if (!prefix || normalized !== key || normalized.includes("../") || normalized.includes("..\\")) {
    throw new Error("Invalid OSS object key.");
  }
  if (!normalized.startsWith(`${prefix}/`)) {
    throw new Error("OSS object key is outside the configured meeting prefix.");
  }
}

function objectUrl(config: OssConfig, key: string) {
  return `https://${config.bucket}.${config.endpoint}/${encodeURI(key).replace(/%2F/g, "/")}`;
}

function hmacSha1Base64(secret: string, value: string) {
  return createHmac("sha1", secret).update(value, "utf8").digest("base64");
}

function canonicalResource(config: OssConfig, key: string, query?: Record<string, string>) {
  let resource = `/${config.bucket}/${key}`;
  if (query) {
    const canonicalQuery = Object.entries(query)
      .filter(([name]) => ["acl", "uploads", "partNumber", "uploadId", "response-content-type"].includes(name))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => (value ? `${name}=${value}` : name))
      .join("&");
    if (canonicalQuery) resource += `?${canonicalQuery}`;
  }
  return resource;
}

function ossHeaderLines(headers: Record<string, string>) {
  return Object.entries(headers)
    .filter(([name]) => name.toLowerCase().startsWith("x-oss-"))
    .map(([name, value]) => [name.toLowerCase(), value.trim()] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}:${value}\n`)
    .join("");
}

function authorizationHeader(input: {
  config: OssConfig;
  method: string;
  key: string;
  contentType?: string;
  date: string;
  headers?: Record<string, string>;
}) {
  const headers = input.headers ?? {};
  const stringToSign = [
    input.method,
    "",
    input.contentType ?? "",
    input.date,
    `${ossHeaderLines(headers)}${canonicalResource(input.config, input.key)}`
  ].join("\n");
  return `OSS ${input.config.accessKeyId}:${hmacSha1Base64(input.config.accessKeySecret, stringToSign)}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function putMeetingObject(input: StoragePutInput): Promise<StorageObjectRef> {
  const config = requireConfig();
  assertMeetingObjectKey(input.key, config);
  const body = typeof input.body === "string" ? Buffer.from(input.body, "utf8") : input.body;
  const contentType = input.mimeType || "application/octet-stream";
  const date = new Date().toUTCString();
  const headers: Record<string, string> = {
    Date: date,
    "Content-Type": contentType
  };
  headers.Authorization = authorizationHeader({ config, method: "PUT", key: input.key, contentType, date });

  const response = await fetchWithTimeout(
    objectUrl(config, input.key),
    {
      method: "PUT",
      headers,
      body
    },
    config.requestTimeoutMs
  );
  if (!response.ok) {
    throw new Error(`OSS putObject failed: ${response.status} ${response.statusText}`);
  }
  return {
    provider: "oss",
    bucket: config.bucket,
    region: config.region,
    endpoint: config.endpoint,
    key: input.key,
    sizeBytes: body.byteLength,
    mimeType: contentType
  };
}

export async function getMeetingObjectText(key: string) {
  const config = requireConfig();
  assertMeetingObjectKey(key, config);
  const date = new Date().toUTCString();
  const headers: Record<string, string> = {
    Date: date
  };
  headers.Authorization = authorizationHeader({ config, method: "GET", key, date });
  const response = await fetchWithTimeout(objectUrl(config, key), { method: "GET", headers }, config.requestTimeoutMs);
  if (!response.ok) {
    throw new Error(`OSS getObject failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

export async function getMeetingObjectBuffer(key: string) {
  const config = requireConfig();
  assertMeetingObjectKey(key, config);
  const date = new Date().toUTCString();
  const headers: Record<string, string> = {
    Date: date
  };
  headers.Authorization = authorizationHeader({ config, method: "GET", key, date });
  const response = await fetchWithTimeout(objectUrl(config, key), { method: "GET", headers }, config.requestTimeoutMs);
  if (!response.ok) {
    throw new Error(`OSS getObject failed: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function getMeetingObjectSignedUrl(key: string, ttlSeconds?: number) {
  const config = requireConfig();
  assertMeetingObjectKey(key, config);
  const expires = Math.floor(Date.now() / 1000) + (ttlSeconds ?? config.signedUrlTtlSeconds);
  const stringToSign = ["GET", "", "", String(expires), canonicalResource(config, key)].join("\n");
  const signature = encodeURIComponent(hmacSha1Base64(config.accessKeySecret, stringToSign));
  return `${objectUrl(config, key)}?OSSAccessKeyId=${encodeURIComponent(config.accessKeyId)}&Expires=${expires}&Signature=${signature}`;
}

export async function deleteMeetingObject(key: string) {
  const config = requireConfig();
  assertMeetingObjectKey(key, config);
  const date = new Date().toUTCString();
  const headers: Record<string, string> = {
    Date: date
  };
  headers.Authorization = authorizationHeader({ config, method: "DELETE", key, date });
  const response = await fetchWithTimeout(objectUrl(config, key), { method: "DELETE", headers }, config.requestTimeoutMs);
  if (!response.ok && response.status !== 404) {
    throw new Error(`OSS deleteObject failed: ${response.status} ${response.statusText}`);
  }
}
