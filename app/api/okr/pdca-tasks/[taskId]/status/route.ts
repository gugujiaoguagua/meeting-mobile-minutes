import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { readOkrProjects, updateOkrPdcaTaskStatus } from "@/lib/okrDbStore";
import type { OkrTaskStatus } from "@/lib/okrTypes";
import { canViewOkrProject } from "@/lib/permission";
import { notifyOkrPdcaReviewConfirmed, notifyOkrPdcaReviewRejected, notifyOkrPdcaReviewSubmitted } from "@/lib/wecomOkrNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedStatuses: OkrTaskStatus[] = ["未开始", "进行中", "已提交待复核", "已完成", "已延期", "阻塞中", "已取消"];
const allowedReviewActions = ["submit", "confirm", "reject"] as const;
type ReviewAction = (typeof allowedReviewActions)[number];

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    status?: unknown;
    reviewTargetStatus?: unknown;
    reviewAction?: unknown;
    reviewRejectedReason?: unknown;
    reviewRejectedItems?: unknown;
  };
  if (typeof body.status !== "string" || !allowedStatuses.includes(body.status as OkrTaskStatus)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }
  if (
    body.reviewTargetStatus !== undefined &&
    (typeof body.reviewTargetStatus !== "string" || !allowedStatuses.includes(body.reviewTargetStatus as OkrTaskStatus))
  ) {
    return NextResponse.json({ error: "invalid reviewTargetStatus" }, { status: 400 });
  }
  if (body.reviewAction !== undefined && (typeof body.reviewAction !== "string" || !allowedReviewActions.includes(body.reviewAction as ReviewAction))) {
    return NextResponse.json({ error: "invalid reviewAction" }, { status: 400 });
  }
  if (body.reviewRejectedReason !== undefined && typeof body.reviewRejectedReason !== "string") {
    return NextResponse.json({ error: "invalid reviewRejectedReason" }, { status: 400 });
  }
  if (body.reviewRejectedItems !== undefined && (!Array.isArray(body.reviewRejectedItems) || !body.reviewRejectedItems.every((item) => typeof item === "string"))) {
    return NextResponse.json({ error: "invalid reviewRejectedItems" }, { status: 400 });
  }

  if (!isDbStateReadEnabled()) {
    return NextResponse.json({ task: { id: (await context.params).taskId, status: body.status } });
  }

  const { taskId } = await context.params;
  try {
    const projects = await readOkrProjects();
    const project = projects.find((item) => item.pdcaTasks.some((task) => task.id === taskId));
    if (!project) return NextResponse.json({ error: "okr_pdca_task_not_found" }, { status: 404 });
    if (!canViewOkrProject(currentUser, project)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const task = await updateOkrPdcaTaskStatus(
      taskId,
      body.status as OkrTaskStatus,
      body.reviewTargetStatus as OkrTaskStatus | undefined,
      body.reviewAction as ReviewAction | undefined,
      body.reviewRejectedReason,
      body.reviewRejectedItems,
      currentUser.id
    );
    if (body.reviewAction === "submit") {
      void notifyOkrPdcaReviewSubmitted(project, task, currentUser).catch((error) => {
        console.warn("wecom_okr_pdca_review_submitted_notification_unhandled", {
          taskId,
          message: error instanceof Error ? error.message : "unknown_error"
        });
      });
    } else if (body.reviewAction === "confirm") {
      void notifyOkrPdcaReviewConfirmed(project, task, currentUser).catch((error) => {
        console.warn("wecom_okr_pdca_review_confirmed_notification_unhandled", {
          taskId,
          message: error instanceof Error ? error.message : "unknown_error"
        });
      });
    } else if (body.reviewAction === "reject") {
      void notifyOkrPdcaReviewRejected(project, task, currentUser).catch((error) => {
        console.warn("wecom_okr_pdca_review_rejected_notification_unhandled", {
          taskId,
          message: error instanceof Error ? error.message : "unknown_error"
        });
      });
    }
    return NextResponse.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json({ error: message }, { status: message === "okr_pdca_task_not_found" ? 404 : 400 });
  }
}
