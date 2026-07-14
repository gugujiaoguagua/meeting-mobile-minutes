import { NextResponse } from "next/server";
import { findAccountByUserId, updateAccountPassword, verifyPassword } from "@/lib/accountAuth";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChangePasswordBody = {
  oldPassword?: unknown;
  newPassword?: unknown;
};

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as ChangePasswordBody;
  const oldPassword = typeof body.oldPassword === "string" ? body.oldPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!oldPassword || newPassword.length < 6) return NextResponse.json({ error: "invalid_password" }, { status: 400 });

  const account = await findAccountByUserId(currentUser.id);
  if (!account || account.disabled || !verifyPassword(oldPassword, account.passwordHash)) {
    return NextResponse.json({ error: "old_password_incorrect" }, { status: 401 });
  }

  await updateAccountPassword(currentUser.id, newPassword);
  return NextResponse.json({ ok: true });
}
