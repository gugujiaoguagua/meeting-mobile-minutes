import { readFileSync } from "node:fs";
import { users } from "@/lib/orgPeopleData";
import type { User } from "@/lib/types";

type UserMap = Record<string, string>;

let cachedMap: UserMap | undefined;

function parseMap(raw?: string) {
  if (!raw?.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const result: UserMap = {};
  Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
    if (typeof value === "string" && value.trim()) result[key.trim()] = value.trim();
  });
  return result;
}

function loadUserMap() {
  if (cachedMap) return cachedMap;
  const inlineMap = parseMap(process.env.WECOM_USER_MAP_JSON);
  const filePath = process.env.WECOM_USER_MAP_FILE?.trim();
  const fileMap = filePath ? parseMap(readFileSync(filePath, "utf8")) : {};
  cachedMap = { ...fileMap, ...inlineMap };
  return cachedMap;
}

function mapCandidates(user: User) {
  return [user.id, user.employeeNo, user.name].filter((value): value is string => Boolean(value));
}

export function resolveWecomUserId(userId: string) {
  const user = users.find((item) => item.id === userId);
  if (!user) return undefined;
  const map = loadUserMap();
  return mapCandidates(user).map((key) => map[key]).find(Boolean);
}

export function findInternalUserByWecomUserId(wecomUserId: string) {
  const normalized = wecomUserId.trim().toLowerCase();
  if (!normalized) return undefined;
  const map = loadUserMap();
  const match = Object.entries(map).find(([, value]) => value.trim().toLowerCase() === normalized);
  if (!match) return undefined;
  const key = match[0];
  return users.find((user) => mapCandidates(user).includes(key));
}
