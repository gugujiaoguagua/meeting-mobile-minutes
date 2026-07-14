import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { MEETING_USER_COOKIE } from "@/lib/auth";
import { getWecomAccessToken, getWecomDeepLinkSecret } from "@/lib/wecomConfig";
import { buildDeviceAwareAppRedirectUrl } from "@/lib/wecomDeepLink";
import { findInternalUserByWecomUserId } from "@/lib/wecomUserMap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OAuthState = {
  page?: string;
  taskId?: string;
  ts?: number;
};

type UserInfoResponse = {
  errcode?: number;
  errmsg?: string;
  UserId?: string;
  userid?: string;
};

function verifyState(state: string): OAuthState | undefined {
  const secret = getWecomDeepLinkSecret();
  const [payload, signature] = state.split(".");
  if (!secret || !payload || !signature) return undefined;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return undefined;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return undefined;
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
  if (!parsed.ts || Date.now() - parsed.ts > 10 * 60 * 1000) return undefined;
  return parsed;
}

async function getWecomUserId(code: string) {
  const accessToken = await getWecomAccessToken();
  const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${encodeURIComponent(accessToken)}&code=${encodeURIComponent(code)}`, {
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`wecom_getuserinfo_${response.status}`);
  const payload = (await response.json()) as UserInfoResponse;
  if (payload.errcode && payload.errcode !== 0) throw new Error(`wecom_getuserinfo_${payload.errcode}`);
  return payload.UserId || payload.userid || "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userAgent = request.headers.get("user-agent");
  const state = verifyState(url.searchParams.get("state") || "");
  const code = url.searchParams.get("code") || "";
  if (!state || !code) {
    return NextResponse.redirect(buildDeviceAwareAppRedirectUrl({ page: "notifications", userAgent }));
  }

  const wecomUserId = await getWecomUserId(code).catch((error) => {
    console.warn("wecom_oauth_getuserinfo_failed", { message: error instanceof Error ? error.message : "unknown_error" });
    return "";
  });
  const user = wecomUserId ? findInternalUserByWecomUserId(wecomUserId) : undefined;
  if (!user) {
    console.warn("wecom_oauth_user_not_mapped", { wecomUserId });
    return NextResponse.redirect(buildDeviceAwareAppRedirectUrl({ page: "notifications", userAgent }));
  }

  const response = NextResponse.redirect(buildDeviceAwareAppRedirectUrl({ page: state.page || "my-tasks", taskId: state.taskId, userAgent }));
  response.cookies.set(MEETING_USER_COOKIE, user.id, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
    secure: url.protocol === "https:"
  });
  return response;
}
