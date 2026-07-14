import { NextResponse } from "next/server";
import { MEETING_USER_COOKIE } from "@/lib/auth";
import { getMeetingPublicBaseUrl } from "@/lib/wecomConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearAuthCookie(response: NextResponse, request: Request) {
  response.cookies.set(MEETING_USER_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:"
  });
  return response;
}

export async function GET(request: Request) {
  return clearAuthCookie(NextResponse.redirect(getMeetingPublicBaseUrl()), request);
}

export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  clearAuthCookie(response, request);
  return response;
}
