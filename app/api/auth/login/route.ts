import { NextResponse } from "next/server";
import { findAuthUserInCurrentState, MEETING_USER_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LoginBody = {
  userId?: unknown;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as LoginBody;
  if (typeof body.userId !== "string") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const user = await findAuthUserInCurrentState(body.userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const response = NextResponse.json({ user });
  response.cookies.set(MEETING_USER_COOKIE, user.id, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:"
  });
  return response;
}
