import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getMeetingPublicBaseUrl, getWecomDeepLinkSecret, getWecomOAuthCorpId } from "@/lib/wecomConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function signState(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export async function GET(request: Request) {
  const corpId = getWecomOAuthCorpId();
  const secret = getWecomDeepLinkSecret();
  if (!corpId || !secret) {
    return NextResponse.json({ error: "wecom_oauth_not_configured" }, { status: 501 });
  }

  const url = new URL(request.url);
  const page = url.searchParams.get("page") || "my-tasks";
  const taskId = url.searchParams.get("taskId") || "";
  const payload = Buffer.from(JSON.stringify({ page, taskId, ts: Date.now() })).toString("base64url");
  const state = `${payload}.${signState(payload, secret)}`;
  const redirectUri = `${getMeetingPublicBaseUrl()}/api/wecom/oauth/callback`;
  const authUrl = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
  authUrl.searchParams.set("appid", corpId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "snsapi_base");
  authUrl.searchParams.set("state", state);
  return NextResponse.redirect(`${authUrl.toString()}#wechat_redirect`);
}
