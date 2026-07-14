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
  const map = loadUserMap();
  if (user) {
    const mapped = mapCandidates(user).map((key) => map[key]).find(Boolean);
    if (mapped) return mapped;
    if (user.source === "wecom" && user.employeeNo) return user.employeeNo;
  }
  if (process.env.WECOM_USERID_FROM_EMP_ID === "1" && userId.startsWith("emp-")) {
    return userId.slice(4);
  }
  return undefined;
}

export function findInternalUserByWecomUserId(wecomUserId: string) {
  const normalized = wecomUserId.trim().toLowerCase();
  if (!normalized) return undefined;
  const map = loadUserMap();
  const match = Object.entries(map).find(([, value]) => value.trim().toLowerCase() === normalized);
  if (match) {
    const key = match[0];
    const mappedUser = users.find((user) => mapCandidates(user).includes(key));
    if (mappedUser) return mappedUser;
  }

  const empUserId = `emp-${wecomUserId.trim()}`.toLowerCase();
  return users.find((user) => {
    const candidateUserId = user.id.trim().toLowerCase();
    const candidateEmployeeNo = user.employeeNo?.trim().toLowerCase();
    if (candidateEmployeeNo === normalized) return true;
    if (candidateUserId === empUserId) return true;
    return user.source === "wecom" && candidateUserId === normalized;
  });
}
