import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { findAccountByUserId } from "@/lib/accountAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const account = await findAccountByUserId(user.id).catch(() => undefined);
  return NextResponse.json({
    user,
    account: account
      ? {
          id: account.id,
          username: account.username,
          mustChangePassword: account.mustChangePassword,
          disabled: account.disabled
        }
      : undefined
  });
}
