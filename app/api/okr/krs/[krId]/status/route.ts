import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { readOkrProjects, updateOkrKrStatus } from "@/lib/okrDbStore";
import type { OkrKrStatus } from "@/lib/okrTypes";
import { canViewOkrProject } from "@/lib/permission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedStatuses: OkrKrStatus[] = ["未开始", "进行中", "已提交待复核", "已完成", "已延期", "阻塞中"];

export async function PATCH(request: Request, context: { params: Promise<{ krId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { status?: unknown };
  if (typeof body.status !== "string" || !allowedStatuses.includes(body.status as OkrKrStatus)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  if (!isDbStateReadEnabled()) {
    return NextResponse.json({ status: body.status });
  }

  const { krId } = await context.params;
  try {
    const projects = await readOkrProjects();
    const project = projects.find((item) => item.krs.some((kr) => kr.id === krId));
    if (!project) return NextResponse.json({ error: "okr_kr_not_found" }, { status: 404 });
    if (!canViewOkrProject(currentUser, project)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const kr = await updateOkrKrStatus(krId, body.status as OkrKrStatus);
    return NextResponse.json({ kr });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json({ error: message }, { status: message === "okr_kr_not_found" ? 404 : 400 });
  }
}
