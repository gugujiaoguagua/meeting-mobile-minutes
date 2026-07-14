import crypto from "node:crypto";
import { getMeetingPublicBaseUrl, getWecomDeepLinkSecret, getWecomOAuthCorpId } from "@/lib/wecomConfig";

type DeepLinkClaims = {
  userId: string;
  page: "my-tasks" | "tasks" | "notifications";
  taskId?: string;
  exp: number;
};

function base64url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function plainDeepLink(params: { page?: string; taskId?: string }) {
  const search = new URLSearchParams();
  if (params.page) search.set("page", params.page);
  if (params.taskId) search.set("taskId", params.taskId);
  const query = search.toString();
  return `${getMeetingPublicBaseUrl()}/${query ? `?${query}` : ""}`;
}

function isMobileUserAgent(userAgent?: string | null) {
  const normalized = (userAgent || "").toLowerCase();
  return /\b(android|iphone|ipad|ipod|windows phone|mobile)\b/.test(normalized);
}

export function buildDeviceAwareAppRedirectUrl(params: { page?: string; taskId?: string; userAgent?: string | null }) {
  const search = new URLSearchParams();
  if (params.page) search.set("page", params.page);
  if (params.taskId) search.set("taskId", params.taskId);
  const query = search.toString();
  const path = isMobileUserAgent(params.userAgent) ? "/mobile-minutes" : "/";
  return `${getMeetingPublicBaseUrl()}${path}${query ? `?${query}` : ""}`;
}

export function createSignedDeepLink(params: { userId: string; page?: DeepLinkClaims["page"]; taskId?: string; ttlSeconds?: number }) {
  const secret = getWecomDeepLinkSecret();
  if (!secret) return undefined;
  const claims: DeepLinkClaims = {
    userId: params.userId,
    page: params.page ?? "my-tasks",
    taskId: params.taskId,
    exp: Math.floor(Date.now() / 1000) + (params.ttlSeconds ?? 7 * 24 * 60 * 60)
  };
  const payload = base64url(JSON.stringify(claims));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySignedDeepLink(token: string): DeepLinkClaims | undefined {
  const secret = getWecomDeepLinkSecret();
  if (!secret) return undefined;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return undefined;
  const expected = sign(payload, secret);
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return undefined;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return undefined;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as DeepLinkClaims;
  if (!claims.userId || !claims.page || claims.exp < Math.floor(Date.now() / 1000)) return undefined;
  return claims;
}

export function buildWecomEntryUrl(params: { reviewerUserId: string; taskId: string }) {
  if (getWecomOAuthCorpId() && getWecomDeepLinkSecret()) {
    const search = new URLSearchParams({ page: "my-tasks", taskId: params.taskId });
    return `${getMeetingPublicBaseUrl()}/api/wecom/oauth/start?${search.toString()}`;
  }

  const signedToken = createSignedDeepLink({ userId: params.reviewerUserId, taskId: params.taskId });
  if (signedToken) {
    return `${getMeetingPublicBaseUrl()}/api/wecom/deeplink?token=${encodeURIComponent(signedToken)}`;
  }

  return plainDeepLink({ page: "my-tasks", taskId: params.taskId });
}

export function buildAppRedirectUrl(params: { page?: string; taskId?: string }) {
  return plainDeepLink({ page: params.page || "my-tasks", taskId: params.taskId });
}
