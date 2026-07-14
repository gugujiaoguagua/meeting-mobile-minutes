import assert from "node:assert/strict";
import test from "node:test";
import { isMeetingDraftEvidenceSupported } from "./aiMeetingDraft";

test("accepts a rewritten task when sourceText quotes the meeting minute", () => {
  assert.equal(
    isMeetingDraftEvidenceSupported({
      supportText: "软件开发组负责在周三前完成客户数据接口测试，验收后交付。",
      content: "推进客户数据接口联调并完成验收交付",
      sourceText: "在周三前完成客户数据接口测试，验收后交付"
    }),
    true
  );
});

test("accepts a conservative paraphrase with substantial wording overlap", () => {
  assert.equal(
    isMeetingDraftEvidenceSupported({
      supportText: "软件开发组负责完成客户数据接口测试，验收后交付。",
      content: "完成客户数据接口联调和验收交付"
    }),
    true
  );
});

test("rejects a task whose content and sourceText are absent from the minute", () => {
  assert.equal(
    isMeetingDraftEvidenceSupported({
      supportText: "软件开发组负责完成客户数据接口测试，验收后交付。",
      content: "采购十台服务器并迁移数据库",
      sourceText: "需要采购服务器并迁移数据库"
    }),
    false
  );
});

test("does not let a short placeholder sourceText bypass unsupported content", () => {
  assert.equal(
    isMeetingDraftEvidenceSupported({
      supportText: "软件开发组负责完成客户数据接口测试，验收后交付。",
      content: "采购十台服务器并迁移数据库",
      sourceText: "待确认"
    }),
    false
  );
});
