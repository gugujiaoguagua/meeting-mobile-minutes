import { dbQuery } from "@/lib/db";
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
  request_json: AiMeetingDraftRequest;
  result_json: AiMeetingDraftJob["result"] | null;
  error: string | null;
  error_detail: string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
};

const memoryJobs = new Map<string, AiMeetingDraftJob>();

function iso(value: Date | string | null | undefined) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRow(row: JobRow): AiMeetingDraftJob {
  return {
    id: row.id,
    status: row.status,
    request: row.request_json,
    result: row.result_json ?? undefined,
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

  const result = await dbQuery<JobRow>(
    `
      insert into ai_meeting_draft_jobs (id, status, request_json, created_by, created_at, updated_at)
      values ($1, $2, $3::jsonb, $4, $5, $5)
      returning *
    `,
    [job.id, job.status, JSON.stringify(job.request), job.createdBy ?? null, job.createdAt]
  );
  return mapRow(result.rows[0]);
}

export async function readAiMeetingDraftJob(jobId: string, useDb: boolean) {
  if (!useDb) return memoryJobs.get(jobId);
  const result = await dbQuery<JobRow>("select * from ai_meeting_draft_jobs where id = $1", [jobId]);
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
  const result = await dbQuery<JobRow>(
    `
      update ai_meeting_draft_jobs
      set status = 'succeeded', result_json = $2::jsonb, error = null, error_detail = null, completed_at = $3, updated_at = $3
      where id = $1
      returning *
    `,
    [jobId, JSON.stringify(resultPayload), now]
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
