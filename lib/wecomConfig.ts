import { readFile } from "node:fs/promises";

type TokenCache = {
  value: string;
  expiresAt: number;
};

let tokenCache: TokenCache | undefined;

export function getWecomAgentId() {
  return Number.parseInt(process.env.WECOM_AGENT_ID || "0", 10);
}

export function getMeetingPublicBaseUrl() {
  return (process.env.MEETING_PUBLIC_BASE_URL || process.env.WECOM_TEXTCARD_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function getWecomOAuthCorpId() {
  return process.env.WECOM_CORP_ID || process.env.WECOM_APP_CORP_ID || "";
}

export function getWecomDeepLinkSecret() {
  return process.env.WECOM_DEEPLINK_SECRET || process.env.WECOM_OAUTH_STATE_SECRET || process.env.NEXTAUTH_SECRET || "";
}

function extractTokenFromPayload(payload: unknown) {
  if (typeof payload === "string") return payload.trim();
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const candidate = record.Message ?? record.message ?? record.access_token ?? record.accessToken ?? record.token;
  return typeof candidate === "string" ? candidate.trim() : "";
}

async function readTokenFromFile(filePath: string) {
  const raw = await readFile(filePath, "utf8");
  try {
    return extractTokenFromPayload(JSON.parse(raw));
  } catch {
    return raw.trim();
  }
}

async function readTokenFromApi(url: string) {
  if (!url) return undefined;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`token_api_${response.status}`);
  const text = await response.text();
  try {
    return extractTokenFromPayload(JSON.parse(text));
  } catch {
    return text.trim();
  }
}

export async function getWecomAccessToken() {
  const directToken = process.env.WECOM_ACCESS_TOKEN?.trim();
  if (directToken) return directToken;

  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.value;

  const tokenFile = process.env.WECOM_TOKEN_FILE?.trim();
  const tokenApiUrl = (process.env.WECOM_TOKEN_API_URL || "").trim();

  const token = tokenFile ? await readTokenFromFile(tokenFile) : await readTokenFromApi(tokenApiUrl);
  if (!token) throw new Error("wecom_token_missing");

  tokenCache = {
    value: token,
    expiresAt: Date.now() + 90 * 60 * 1000
  };
  return token;
}
