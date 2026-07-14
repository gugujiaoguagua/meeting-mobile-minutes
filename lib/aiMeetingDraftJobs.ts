import { dbQuery } from "@/lib/db";
import { resolveLargeMeetingText, saveLargeMeetingText } from "@/lib/meetingLargeContent";
import type { AiMeetingDraftRequest, AiMeetingDraftResponse } from "@/lib/aiMeetingDraft";

export type AiMeetingDraftJobStatus = "queued" | "processing" | "succeeded" | "failed";

export type AiMeetingDraftJob = {
  id: string;
  status: AiMeetingDraftJobStatus;
  request: AiMeetingDraftRequest;
  result?: AiMeetingDraftResponse & {
    correctedTranscript?: string;
    dictionaryCorrections?: unknown[];
  };
  error?: string;
  errorDetail?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};

type JobRow = {
  id: string;
  status: AiMeetingDraftJobStatus;
  request_json: unknown;
  result_json: unknown;
  request_object_id: string | null;
  result_object_id: string | null;
  error: string | null;
  error_detail: string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
};

const memoryJobs = new Map<string, AiMeetingDraftJob>();
const EXTERNALIZE_JSON_THRESHOLD_BYTES = 32 * 1024;

function iso(value: Date | string | null | undefined) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function resolveJsonPayload<T>(inlinePayload: unknown, objectId?: string | null) {
  if (!objectId) return inlinePayload as T;
  const raw = await resolveLargeMeetingText({
    inlineText: typeof inlinePayload === "string" ? inlinePayload : JSON.stringify(inlinePayload ?? {}),
    objectId
  });
  return JSON.parse(raw) as T;
}

function jsonSize(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

async function externalizeJobPayload(input: {
  jobId: string;
  meetingId: string;
  category: "ai_draft_request" | "ai_draft_result";
  payload: unknown;
  createdBy?: string;
}) {
  if (jsonSize(input.payload) <= EXTERNALIZE_JSON_THRESHOLD_BYTES) {
    return { payload: input.payload, objectId: undefined };
  }
  const saved = await saveLargeMeetingText({
    meetingId: input.meetingId,
    category: input.category,
    text: JSON.stringify(input.payload),
    createdBy: input.createdBy,
    mimeType: "application/json; charset=utf-8"
  });
  if (!saved.objectId) return { payload: input.payload, objectId: undefined };
  return {
    payload: {
      meetingId: input.meetingId,
      jobId: input.jobId,
      externalized: true,
      objectId: saved.objectId
    },
    objectId: saved.objectId
  };
}

async function mapRow(row: JobRow): Promise<AiMeetingDraftJob> {
  return {
    id: row.id,
    status: row.status,
    request: await resolveJsonPayload<AiMeetingDraftRequest>(row.request_json, row.request_object_id),
    result: row.result_json ? await resolveJsonPayload<AiMeetingDraftJob["result"]>(row.result_json, row.result_object_id) : undefined,
    error: row.error ?? undefined,
    errorDetail: row.error_detail ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at)
  };
}

export function nextAiMeetingDraftJobId() {
  return `ai-draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createAiMeetingDraftJob(input: { id: string; request: AiMeetingDraftRequest; createdBy?: string; useDb: boolean }) {
  const now = new Date().toISOString();
  const job: AiMeetingDraftJob = {
    id: input.id,
    status: "queued",
    request: input.request,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now
  };

  if (!input.useDb) {
    memoryJobs.set(job.id, job);
    return job;
  }

  const requestPayload = await externalizeJobPayload({
    jobId: job.id,
    meetingId: job.request.meetingId,
    category: "ai_draft_request",
    payload: job.request,
    createdBy: job.createdBy
  });

  const result = await dbQuery<JobRow>(
    `
      insert into ai_meeting_draft_jobs (id, status, request_json, request_object_id, created_by, created_at, updated_at)
      values ($1, $2, $3::jsonb, $4, $5, $6, $6)
      returning *
    `,
    [job.id, job.status, JSON.stringify(requestPayload.payload), requestPayload.objectId ?? null, job.createdBy ?? null, job.createdAt]
  );
  return mapRow(result.rows[0]);
}

export async function readAiMeetingDraftJob(jobId: string, useDb: boolean) {
  if (!useDb) return memoryJobs.get(jobId);
  const result = await dbQuery<JobRow>("select * from ai_meeting_draft_jobs where id = $1", [jobId]);
  return result.rows[0] ? mapRow(result.rows[0]) : undefined;
}

export async function readLatestAiMeetingDraftJobByMeetingId(meetingId: string, useDb: boolean) {
  if (!useDb) {
    return [...memoryJobs.values()]
      .filter((job) => job.request.meetingId === meetingId && job.status === "succeeded")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  }
  const result = await dbQuery<JobRow>(
    `
      select *
      from ai_meeting_draft_jobs
      where request_json->>'meetingId' = $1 and status = 'succeeded'
      order by updated_at desc
      limit 1
    `,
    [meetingId]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : undefined;
}

export async function markAiMeetingDraftJobProcessing(jobId: string, useDb: boolean) {
  const now = new Date().toISOString();
  if (!useDb) {
    const job = memoryJobs.get(jobId);
    if (!job) return undefined;
    const next = { ...job, status: "processing" as const, updatedAt: now, startedAt: now };
    memoryJobs.set(jobId, next);
    return next;
  }
  const result = await dbQuery<JobRow>(
    `
      update ai_meeting_draft_jobs
      set status = 'processing', started_at = coalesce(started_at, $2), updated_at = $2
      where id = $1
      returning *
    `,
    [jobId, now]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : undefined;
}

export async function markAiMeetingDraftJobSucceeded(jobId: string, resultPayload: AiMeetingDraftJob["result"], useDb: boolean) {
  const now = new Date().toISOString();
  if (!useDb) {
    const job = memoryJobs.get(jobId);
    if (!job) return undefined;
    const next = { ...job, status: "succeeded" as const, result: resultPayload, updatedAt: now, completedAt: now };
    memoryJobs.set(jobId, next);
    return next;
  }
  const existing = await dbQuery<{ meetingId: string | null; createdBy: string | null }>(
    `select request_json->>'meetingId' as "meetingId", created_by as "createdBy" from ai_meeting_draft_jobs where id = $1`,
    [jobId]
  );
  const meetingId = existing.rows[0]?.meetingId || jobId;
  const storedResult = await externalizeJobPayload({
    jobId,
    meetingId,
    category: "ai_draft_result",
    payload: resultPayload,
    createdBy: existing.rows[0]?.createdBy ?? undefined
  });
  const result = await dbQuery<JobRow>(
    `
      update ai_meeting_draft_jobs
      set status = 'succeeded', result_json = $2::jsonb, result_object_id = $3,
          error = null, error_detail = null, completed_at = $4, updated_at = $4
      where id = $1
      returning *
    `,
    [jobId, JSON.stringify(storedResult.payload), storedResult.objectId ?? null, now]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : undefined;
}

export async function markAiMeetingDraftJobFailed(jobId: string, error: string, detail: string, useDb: boolean) {
  const now = new Date().toISOString();
  if (!useDb) {
    const job = memoryJobs.get(jobId);
    if (!job) return undefined;
    const next = { ...job, status: "failed" as const, error, errorDetail: detail, updatedAt: now, completedAt: now };
    memoryJobs.set(jobId, next);
    return next;
  }
  const result = await dbQuery<JobRow>(
    `
      update ai_meeting_draft_jobs
      set status = 'failed', error = $2, error_detail = $3, completed_at = $4, updated_at = $4
      where id = $1
      returning *
    `,
    [jobId, error, detail, now]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : undefined;
}
