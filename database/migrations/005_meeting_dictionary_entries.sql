-- Meeting dictionary entries used to correct common transcription mistakes before AI draft generation.

begin;

create table if not exists meeting_dictionary_entries (
  id text primary key,
  standard text not null,
  variants text not null default '',
  category text not null default '业务词',
  note text not null default '',
  created_by_user_id text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meeting_dictionary_entries_category_idx on meeting_dictionary_entries (category);
create index if not exists meeting_dictionary_entries_created_at_idx on meeting_dictionary_entries (created_at desc);

insert into meeting_dictionary_entries (id, standard, variants, category, note, created_at, updated_at)
values
  ('dict-seed-lami', '拉迷', '拉米、腊米、拉迷集团', '品牌词', '拉手的拉，迷人的迷；公司品牌名称。', '2026-06-30 00:00:00+08', '2026-06-30 00:00:00+08'),
  ('dict-seed-3vjia', '三维家', '三围家、3维家', '系统名', '设计与下单相关系统，OKR 项目重点优化对象。', '2026-06-30 00:00:00+08', '2026-06-30 00:00:00+08'),
  ('dict-seed-wecom', '企业微信', '企微、企业微、企业威信', '工具名', '公司主要办公协同工具。', '2026-06-30 00:00:00+08', '2026-06-30 00:00:00+08'),
  ('dict-seed-linyuchen', '林昱辰', '林宇辰、林玉成', '员工姓名', '用于会议转写纠错和 AI 纪要识别。', '2026-06-30 00:00:00+08', '2026-06-30 00:00:00+08'),
  ('dict-seed-jiangwenxuan', '蒋文轩', '蒋文宣、姜文轩', '员工姓名', '用于会议转写纠错和 AI 纪要识别。', '2026-06-30 00:00:00+08', '2026-06-30 00:00:00+08')
on conflict (id) do nothing;

commit;

