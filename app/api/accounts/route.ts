import { NextResponse } from "next/server";
import { listAccounts, setAccountDisabled, updateAccountPassword } from "@/lib/accountAuth";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AccountPatchBody = {
  userId?: unknown;
  action?: unknown;
  disabled?: unknown;
};

function publicAccount(account: Awaited<ReturnType<typeof listAccounts>>[number]) {
  return {
    id: account.id,
    userId: account.userId,
    username: account.username,
    mustChangePassword: account.mustChangePassword,
    disabled: account.disabled,
    updatedAt: account.updatedAt,
    user: account.user
  };
}

async function requirePresident() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return { response: NextResponse.json({ error: "not authenticated" }, { status: 401 }) };
  if (currentUser.role !== "总裁") return { response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { currentUser };
}

export async function GET() {
  const guard = await requirePresident();
  if (guard.response) return guard.response;
  const accounts = await listAccounts();
  return NextResponse.json({ accounts: accounts.map(publicAccount) });
}

export async function PATCH(request: Request) {
  const guard = await requirePresident();
  if (guard.response) return guard.response;

  const body = (await request.json().catch(() => ({}))) as AccountPatchBody;
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!userId) return NextResponse.json({ error: "userId_required" }, { status: 400 });

  if (body.action === "reset_password") {
    await updateAccountPassword(userId, "123456");
  } else if (body.action === "set_disabled") {
    await setAccountDisabled(userId, Boolean(body.disabled));
  } else {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const accounts = await listAccounts();
  return NextResponse.json({ accounts: accounts.map(publicAccount) });
}
