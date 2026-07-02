import { cookies } from "next/headers";
import { users } from "@/lib/orgPeopleData";
import type { User } from "@/lib/types";

export const MEETING_USER_COOKIE = "meeting_user_id";

export function findAuthUser(userId?: string | null): User | undefined {
  return userId ? users.find((user) => user.id === userId) : undefined;
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  return findAuthUser(cookieStore.get(MEETING_USER_COOKIE)?.value);
}

export function canResetState(user: User) {
  return user.role === "总裁";
}

