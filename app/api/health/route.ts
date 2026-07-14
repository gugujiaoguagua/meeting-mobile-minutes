import { NextResponse } from "next/server";
import { dbQuery, getDatabaseUrl, isDbStateReadEnabled } from "@/lib/db";
import { getObjectStoragePublicConfig } from "@/lib/objectStorage";
import { isTencentAsrConfigured, isTencentRealtimeAsrConfigured } from "@/lib/tencentAsr";

type CheckStatus = "ok" | "warn" | "error";

type HealthCheck = {
  name: string;
  status: CheckStatus;
  detail: string;
};

function hasEnv(...names: string[]) {
  return names.some((name) => Boolean(process.env[name]?.trim()));
}

async function checkDatabase(): Promise<HealthCheck> {
  if (!getDatabaseUrl()) {
    return {
      name: "database",
      status: "warn",
      detail: "database url is not configured"
    };
  }

  try {
    await dbQuery("select 1 as ok");
    return {
      name: "database",
      status: "ok",
      detail: "postgres connection ok"
    };
  } catch {
    return {
      name: "database",
      status: "error",
      detail: "postgres connection failed"
    };
  }
}

export const dynamic = "force-dynamic";

export async function GET() {
  const objectStorage = getObjectStoragePublicConfig();
  const checks: HealthCheck[] = [
    {
      name: "app",
      status: "ok",
      detail: "meeting backend is running"
    },
    {
      name: "stateStore",
      status: isDbStateReadEnabled() ? "ok" : "warn",
      detail: isDbStateReadEnabled() ? "database state store enabled" : "database state store is not enabled"
    },
    await checkDatabase(),
    {
      name: "tencentAsr",
      status: isTencentAsrConfigured() ? "ok" : "warn",
      detail: isTencentAsrConfigured() ? "recording file ASR configured" : "recording file ASR not configured"
    },
    {
      name: "tencentRealtimeAsr",
      status: isTencentRealtimeAsrConfigured() ? "ok" : "warn",
      detail: isTencentRealtimeAsrConfigured() ? "realtime ASR configured" : "realtime ASR not configured"
    },
    {
      name: "aiDraft",
      status: hasEnv("DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_FILE") ? "ok" : "warn",
      detail: hasEnv("DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_FILE") ? "AI draft key source configured" : "AI draft key source not configured"
    },
    {
      name: "objectStorage",
      status: objectStorage.enabled && objectStorage.configured ? "ok" : objectStorage.enabled ? "warn" : "warn",
      detail: objectStorage.enabled
        ? objectStorage.configured
          ? `OSS configured: ${objectStorage.bucket}/${objectStorage.prefix}`
          : "OSS is enabled but not fully configured"
        : "object storage is not enabled"
    }
  ];

  const status: CheckStatus = checks.some((check) => check.status === "error") ? "error" : checks.some((check) => check.status === "warn") ? "warn" : "ok";
  const httpStatus = status === "error" ? 503 : 200;

  return NextResponse.json(
    {
      service: "meeting-loop-backend",
      status,
      checkedAt: new Date().toISOString(),
      publicBaseUrl: process.env.MEETING_PUBLIC_BASE_URL || "",
      objectStorageConfigured: objectStorage.enabled && objectStorage.configured,
      objectStorageProvider: objectStorage.provider,
      objectStorageBucket: objectStorage.bucket,
      objectStoragePrefix: objectStorage.prefix,
      checks
    },
    {
      status: httpStatus,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
