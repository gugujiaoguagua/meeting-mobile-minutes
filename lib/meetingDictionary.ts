import { dbQuery, isDbStateReadEnabled } from "@/lib/db";

export type MeetingDictionaryEntry = {
  id: string;
  standard: string;
  variants: string;
  category: string;
  note: string;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
};

export type MeetingDictionaryCorrection = {
  standard: string;
  variant: string;
  count: number;
};

type MeetingDictionaryRow = {
  id: string;
  standard: string;
  variants: string;
  category: string;
  note: string;
  createdByUserId?: string | null;
  createdAt: string;
  updatedAt: string;
};

const seedCreatedAt = "2026-06-30 00:00";

const defaultDictionaryEntries: MeetingDictionaryEntry[] = [
  { id: "dict-seed-lami", standard: "拉迷", variants: "拉米、腊米、拉迷集团", category: "品牌词", note: "拉手的拉，迷人的迷；公司品牌名称。", createdAt: seedCreatedAt, updatedAt: seedCreatedAt },
  { id: "dict-seed-3vjia", standard: "三维家", variants: "三围家、3维家", category: "系统名", note: "设计与下单相关系统，OKR 项目重点优化对象。", createdAt: seedCreatedAt, updatedAt: seedCreatedAt },
  { id: "dict-seed-wecom", standard: "企业微信", variants: "企微、企业微、企业威信", category: "工具名", note: "公司主要办公协同工具。", createdAt: seedCreatedAt, updatedAt: seedCreatedAt },
  { id: "dict-seed-linyuchen", standard: "林昱辰", variants: "林宇辰、林玉成", category: "员工姓名", note: "用于会议转写纠错和 AI 纪要识别。", createdAt: seedCreatedAt, updatedAt: seedCreatedAt },
  { id: "dict-seed-jiangwenxuan", standard: "蒋文轩", variants: "蒋文宣、姜文轩", category: "员工姓名", note: "用于会议转写纠错和 AI 纪要识别。", createdAt: seedCreatedAt, updatedAt: seedCreatedAt }
];

let localEntries = [...defaultDictionaryEntries];

function nextDictionaryId() {
  return `dict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeEntry(row: MeetingDictionaryRow): MeetingDictionaryEntry {
  return {
    id: row.id,
    standard: row.standard,
    variants: row.variants,
    category: row.category,
    note: row.note,
    createdByUserId: row.createdByUserId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function normalizeText(value: string, fallback = "") {
  return value.replace(/\s+/g, " ").trim() || fallback;
}

export function splitDictionaryVariants(variants: string) {
  return variants
    .split(/[、,，;；\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function countOccurrences(text: string, term: string) {
  if (!term) return 0;
  let count = 0;
  let index = text.indexOf(term);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}

export function applyMeetingDictionaryCorrections(text: string, entries: MeetingDictionaryEntry[]) {
  let correctedText = text;
  const corrections: MeetingDictionaryCorrection[] = [];
  const rules = entries
    .flatMap((entry) =>
      splitDictionaryVariants(entry.variants)
        .filter((variant) => variant && variant !== entry.standard)
        .map((variant) => ({ standard: entry.standard, variant }))
    )
    .sort((a, b) => b.variant.length - a.variant.length);

  rules.forEach((rule) => {
    const count = countOccurrences(correctedText, rule.variant);
    if (!count) return;
    correctedText = correctedText.split(rule.variant).join(rule.standard);
    const existing = corrections.find((item) => item.standard === rule.standard && item.variant === rule.variant);
    if (existing) existing.count += count;
    else corrections.push({ ...rule, count });
  });

  return { correctedText, corrections };
}

export async function listMeetingDictionaryEntries() {
  if (!isDbStateReadEnabled()) return [...localEntries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const result = await dbQuery<MeetingDictionaryRow>(
    `
      select
        id,
        standard,
        variants,
        category,
        note,
        created_by_user_id as "createdByUserId",
        to_char(created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as "createdAt",
        to_char(updated_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as "updatedAt"
      from meeting_dictionary_entries
      order by created_at desc, id desc
    `
  );
  return result.rows.map(normalizeEntry);
}

export async function createMeetingDictionaryEntry(input: {
  standard: string;
  variants?: string;
  category?: string;
  note?: string;
  createdByUserId?: string;
}) {
  const now = new Date();
  const id = nextDictionaryId();
  const standard = normalizeText(input.standard);
  if (!standard) throw new Error("standard_required");
  const entry = {
    id,
    standard,
    variants: normalizeText(input.variants ?? "", "待补充"),
    category: normalizeText(input.category ?? "", "业务词"),
    note: normalizeText(input.note ?? "", "用于会议转写纠错和 AI 纪要识别。"),
    createdByUserId: input.createdByUserId,
    createdAt: now.toISOString().slice(0, 16).replace("T", " "),
    updatedAt: now.toISOString().slice(0, 16).replace("T", " ")
  };

  if (!isDbStateReadEnabled()) {
    localEntries = [entry, ...localEntries];
    return entry;
  }

  const result = await dbQuery<MeetingDictionaryRow>(
    `
      insert into meeting_dictionary_entries (id, standard, variants, category, note, created_by_user_id)
      values ($1,$2,$3,$4,$5,$6)
      returning
        id,
        standard,
        variants,
        category,
        note,
        created_by_user_id as "createdByUserId",
        to_char(created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as "createdAt",
        to_char(updated_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as "updatedAt"
    `,
    [entry.id, entry.standard, entry.variants, entry.category, entry.note, entry.createdByUserId ?? null]
  );
  return normalizeEntry(result.rows[0]);
}

export async function deleteMeetingDictionaryEntry(entryId: string) {
  if (!isDbStateReadEnabled()) {
    const before = localEntries.length;
    localEntries = localEntries.filter((entry) => entry.id !== entryId);
    return before !== localEntries.length;
  }
  const result = await dbQuery("delete from meeting_dictionary_entries where id = $1", [entryId]);
  return (result.rowCount ?? 0) > 0;
}

