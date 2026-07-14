import { cookies } from "next/headers";
import { isDbStateReadEnabled } from "@/lib/db";
import { readDbState } from "@/lib/dbStateStore";
import { readLocalState } from "@/lib/localStateStore";
import { buildCanonicalUserDirectory } from "@/lib/canonicalUsers";
import { users } from "@/lib/orgPeopleData";
import type { User } from "@/lib/types";

export const MEETING_USER_COOKIE = "meeting_user_id";

export function findAuthUser(userId?: string | null): User | undefined {
  return userId ? users.find((user) => user.id === userId) : undefined;
}

export async function findAuthUserInCurrentState(userId?: string | null): Promise<User | undefined> {
  if (!userId) return undefined;
  const fallback = findAuthUser(userId);
  try {
    const state = isDbStateReadEnabled() ? await readDbState() : await readLocalState();
    const directory = buildCanonicalUserDirectory(state.users);
    const canonicalUserId = directory.aliasToCanonicalUserId[userId] ?? userId;
    return directory.users.find((user) => user.id === canonicalUserId) ?? fallback;
  } catch (error) {
    console.warn("auth_current_state_lookup_failed", { userId, message: error instanceof Error ? error.message : "unknown_error" });
    return fallback;
  }
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  return findAuthUserInCurrentState(cookieStore.get(MEETING_USER_COOKIE)?.value);
}

export function canResetState(user: User) {
  return user.role === "总裁";
}
