import { NextResponse } from "next/server";
import { MEETING_USER_COOKIE } from "@/lib/auth";
import { buildAppRedirectUrl, verifySignedDeepLink } from "@/lib/wecomDeepLink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const claims = verifySignedDeepLink(token);
  if (!claims) {
    return NextResponse.redirect(buildAppRedirectUrl({ page: "notifications" }));
  }

  const response = NextResponse.redirect(buildAppRedirectUrl({ page: claims.page, taskId: claims.taskId }));
  response.cookies.set(MEETING_USER_COOKIE, claims.userId, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
    secure: url.protocol === "https:"
  });
  return response;
}
