import { createHmac } from "node:crypto";

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
    region: env("MEETING_OSS_REGION", env("OSS_REGION")),
    endpoint: normalizeEndpoint(env("MEETING_OSS_ENDPOINT", env("OSS_ENDPOINT")), bucket),
    bucket,
    prefix: normalizePrefix(env("MEETING_OSS_PREFIX", env("OSS_PREFIX"))),
    accessKeyId: env("MEETING_OSS_ACCESS_KEY_ID", env("OSS_ACCESS_KEY_ID")),
    accessKeySecret: env("MEETING_OSS_ACCESS_KEY_SECRET", env("OSS_ACCESS_KEY_SECRET")),
    ttlSeconds: Number.parseInt(env("MEETING_OSS_SIGNED_URL_TTL_SECONDS", "7200"), 10),
    requestTimeoutMs: Number.parseInt(env("MEETING_OSS_REQUEST_TIMEOUT_MS", "300000"), 10)
  };
}

function configured(cfg) {
  return Boolean(cfg.region && cfg.endpoint && cfg.bucket && cfg.prefix && cfg.accessKeyId && cfg.accessKeySecret);
}

function hmac(secret, value) {
  return createHmac("sha1", secret).update(value, "utf8").digest("base64");
}

function resource(cfg, key) {
  return `/${cfg.bucket}/${key}`;
}

function url(cfg, key) {
  return `https://${cfg.bucket}.${cfg.endpoint}/${encodeURI(key).replace(/%2F/g, "/")}`;
}

function auth(cfg, method, key, contentType, date) {
  const stringToSign = [method, "", contentType || "", date, resource(cfg, key)].join("\n");
  return `OSS ${cfg.accessKeyId}:${hmac(cfg.accessKeySecret, stringToSign)}`;
}

async function request(cfg, key, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.requestTimeoutMs);
  try {
    return await fetch(url(cfg, key), { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const cfg = config();
  console.log(`ossConfigured=${configured(cfg)}`);
  console.log(`bucket=${cfg.bucket || ""}`);
  console.log(`prefix=${cfg.prefix || ""}`);
  if (!configured(cfg)) process.exit(2);

  const key = `${cfg.prefix}/_health/${Date.now()}.txt`;
  const body = Buffer.from(`meeting object storage check ${new Date().toISOString()}\n`, "utf8");
  const contentType = "text/plain; charset=utf-8";
  const putDate = new Date().toUTCString();
  const putResponse = await request(cfg, key, {
    method: "PUT",
    headers: {
      Date: putDate,
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      Authorization: auth(cfg, "PUT", key, contentType, putDate)
    },
    body
  });
  console.log(`write=${putResponse.ok}`);
  if (!putResponse.ok) throw new Error(`write failed: ${putResponse.status}`);

  const getDate = new Date().toUTCString();
  const getResponse = await request(cfg, key, {
    method: "GET",
    headers: {
      Date: getDate,
      Authorization: auth(cfg, "GET", key, "", getDate)
    }
  });
  const text = await getResponse.text();
  console.log(`read=${getResponse.ok && text.includes("meeting object storage check")}`);
  if (!getResponse.ok) throw new Error(`read failed: ${getResponse.status}`);

  const expires = Math.floor(Date.now() / 1000) + (Number.isFinite(cfg.ttlSeconds) ? cfg.ttlSeconds : 7200);
  const signature = encodeURIComponent(hmac(cfg.accessKeySecret, ["GET", "", "", String(expires), resource(cfg, key)].join("\n")));
  const signedUrl = `${url(cfg, key)}?OSSAccessKeyId=${encodeURIComponent(cfg.accessKeyId)}&Expires=${expires}&Signature=${signature}`;
  const signedResponse = await fetch(signedUrl, { method: "GET" });
  console.log(`signedUrl=${signedResponse.ok}`);
  if (!signedResponse.ok) throw new Error(`signed url failed: ${signedResponse.status}`);

  const deleteDate = new Date().toUTCString();
  const deleteResponse = await request(cfg, key, {
    method: "DELETE",
    headers: {
      Date: deleteDate,
      Authorization: auth(cfg, "DELETE", key, "", deleteDate)
    }
  });
  console.log(`delete=${deleteResponse.ok || deleteResponse.status === 404}`);
  if (!deleteResponse.ok && deleteResponse.status !== 404) throw new Error(`delete failed: ${deleteResponse.status}`);
}

main().catch((error) => {
  console.error(`objectStorageCheckFailed=${error instanceof Error ? error.message : "unknown"}`);
  process.exit(1);
});
