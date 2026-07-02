import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createMeetingDictionaryEntry, deleteMeetingDictionaryEntry, listMeetingDictionaryEntries } from "@/lib/meetingDictionary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DictionaryBody = {
  standard?: unknown;
  variants?: unknown;
  category?: unknown;
  note?: unknown;
};

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const entries = await listMeetingDictionaryEntries();
  return NextResponse.json({ entries });
}

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as DictionaryBody;
  if (typeof body.standard !== "string" || !body.standard.trim()) {
    return NextResponse.json({ error: "standard_required" }, { status: 400 });
  }

  const entry = await createMeetingDictionaryEntry({
    standard: body.standard,
    variants: typeof body.variants === "string" ? body.variants : "",
    category: typeof body.category === "string" ? body.category : "业务词",
    note: typeof body.note === "string" ? body.note : "",
    createdByUserId: currentUser.id
  });
  return NextResponse.json({ entry });
}

export async function DELETE(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

  const deleted = await deleteMeetingDictionaryEntry(id);
  return NextResponse.json({ deleted });
}

