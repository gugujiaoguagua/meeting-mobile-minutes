import { NextResponse } from "next/server";
import { findAccountByUsername, findAccountsByName, verifyPassword } from "@/lib/accountAuth";
import { MEETING_USER_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LoginBody = {
  username?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as LoginBody;
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) return NextResponse.json({ error: "请输入账号和密码。" }, { status: 400 });

  let account = await findAccountByUsername(username);
  if (!account) {
    const sameNameAccounts = await findAccountsByName(username);
    const enabledAccounts = sameNameAccounts.filter((item) => !item.disabled);
    if (enabledAccounts.length === 1 && verifyPassword(password, enabledAccounts[0].passwordHash)) {
      account = enabledAccounts[0];
    } else if (enabledAccounts.length > 1) {
      const usernames = enabledAccounts.map((item) => item.username).join("、");
      return NextResponse.json({ error: `存在多个同名账号，请使用完整账号：${usernames}` }, { status: 409 });
    }
  }
  if (!account?.user || account.disabled || !verifyPassword(password, account.passwordHash)) {
    return NextResponse.json({ error: "账号或密码不正确。" }, { status: 401 });
  }

  const response = NextResponse.json({ user: account.user, account: { id: account.id, username: account.username, mustChangePassword: account.mustChangePassword } });
  response.cookies.set(MEETING_USER_COOKIE, account.user.id, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:"
  });
  return response;
}
