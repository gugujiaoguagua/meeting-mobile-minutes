#!/usr/bin/env node
import { createHmac } from "node:crypto";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const inline = process.argv.find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function env(name, fallback = "") {
  return (process.env[name] || fallback).trim();
}

function normalizePrefix(value) {
  return value.replace(/^\/+|\/+$/g, "");
}

function normalizeEndpoint(value, bucket) {
  let endpoint = value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
  if (bucket && endpoint.startsWith(`${bucket}.`)) endpoint = endpoint.slice(bucket.length + 1);
  return endpoint;
}

function config() {
  const bucket = env("MEETING_OSS_BUCKET", env("OSS_BUCKET"));
  return {
    endpoint: normalizeEndpoint(env("MEETING_OSS_ENDPOINT", env("OSS_ENDPOINT")), bucket),
    bucket,
    prefix: normalizePrefix(env("MEETING_OSS_PREFIX", env("OSS_PREFIX"))),
    accessKeyId: env("MEETING_OSS_ACCESS_KEY_ID", env("OSS_ACCESS_KEY_ID")),
    accessKeySecret: env("MEETING_OSS_ACCESS_KEY_SECRET", env("OSS_ACCESS_KEY_SECRET")),
    requestTimeoutMs: Number.parseInt(env("MEETING_OSS_REQUEST_TIMEOUT_MS", "300000"), 10)
  };
}

function configured(cfg) {
  return Boolean(cfg.endpoint && cfg.bucket && cfg.prefix && cfg.accessKeyId && cfg.accessKeySecret);
}

function sanitizeKeyPart(part) {
  const value = part.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!value || value === "." || value === ".." || value.includes("../") || value.includes("..\\")) {
    throw new Error("Invalid OSS key suffix.");
  }
  return value;
}

function objectKey(cfg, suffix) {
  const normalizedSuffix = sanitizeKeyPart(suffix);
  return `${cfg.prefix}/${normalizedSuffix}`;
}

function hmac(secret, value) {
  return createHmac("sha1", secret).update(value, "utf8").digest("base64");
}

function resource(cfg, key) {
  return `/${cfg.bucket}/${key}`;
}

function objectUrl(cfg, key) {
  return `https://${cfg.bucket}.${cfg.endpoint}/${encodeURI(key).replace(/%2F/g, "/")}`;
}

function auth(cfg, method, key, contentType, date) {
  const stringToSign = [method, "", contentType || "", date, resource(cfg, key)].join("\n");
  return `OSS ${cfg.accessKeyId}:${hmac(cfg.accessKeySecret, stringToSign)}`;
}

async function requestWithTimeout(cfg, url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.requestTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function putObject(cfg, key, body, contentType) {
  const date = new Date().toUTCString();
  const response = await requestWithTimeout(cfg, objectUrl(cfg, key), {
    method: "PUT",
    headers: {
      Date: date,
      "Content-Type": contentType,
      Authorization: auth(cfg, "PUT", key, contentType, date)
    },
    body
  });
  if (!response.ok) throw new Error(`OSS backup upload failed: ${response.status} ${response.statusText}`);
}

async function headObject(cfg, key) {
  const date = new Date().toUTCString();
  const response = await requestWithTimeout(cfg, objectUrl(cfg, key), {
    method: "HEAD",
    headers: {
      Date: date,
      Authorization: auth(cfg, "HEAD", key, "", date)
    }
  });
  if (!response.ok) throw new Error(`OSS backup head failed: ${response.status} ${response.statusText}`);
  return response;
}

async function main() {
  const file = arg("file");
  const keySuffix = arg("key-suffix");
  const expectedBytes = Number.parseInt(arg("expected-bytes", "0"), 10);
  const sha256 = arg("sha256");
  if (!file || !keySuffix) {
    console.error("Usage: node scripts/upload-postgres-backup-to-oss.mjs --file <path> --key-suffix <suffix> [--expected-bytes <bytes>] [--sha256 <sha256>]");
    process.exit(2);
  }

  const cfg = config();
  if (!configured(cfg)) throw new Error("Aliyun OSS is not fully configured.");

  const filePath = path.resolve(file);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size <= 0) throw new Error(`Backup file is empty or not a file: ${filePath}`);
  if (expectedBytes > 0 && fileStat.size !== expectedBytes) {
    throw new Error(`Backup file size mismatch before upload: expected=${expectedBytes} actual=${fileStat.size}`);
  }

  const key = objectKey(cfg, keySuffix);
  const body = await readFile(filePath);
  await putObject(cfg, key, body, "application/gzip");

  const head = await headObject(cfg, key);
  const uploadedBytes = Number.parseInt(head.headers.get("content-length") || "0", 10);
  if (uploadedBytes !== fileStat.size) {
    throw new Error(`Backup upload size mismatch: local=${fileStat.size} oss=${uploadedBytes}`);
  }

  console.log(`postgresBackupUploaded=true`);
  console.log(`postgresBackupKey=${key}`);
  console.log(`postgresBackupBytes=${fileStat.size}`);
  if (sha256) console.log(`postgresBackupSha256=${sha256}`);
}

main().catch((error) => {
  console.error(`postgresBackupUploadFailed=${error instanceof Error ? error.message : "unknown"}`);
  process.exit(1);
});
