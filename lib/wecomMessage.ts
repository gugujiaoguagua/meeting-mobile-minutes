import { getWecomAccessToken, getWecomAgentId } from "@/lib/wecomConfig";

type TextcardInput = {
  touser: string;
  title: string;
  description: string;
  url: string;
  btntxt?: string;
};

export type WecomSendResult = {
  skipped?: boolean;
  errcode?: number;
  errmsg?: string;
  invaliduser?: string;
  msgid?: string;
};

export function escapeWecomText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendWecomTextcard(input: TextcardInput): Promise<WecomSendResult> {
  const agentid = getWecomAgentId();
  if (!Number.isFinite(agentid)) return { skipped: true, errmsg: "invalid_agentid_config" };

  const accessToken = await getWecomAccessToken();
  const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      touser: input.touser,
      msgtype: "textcard",
      agentid,
      textcard: {
        title: input.title,
        description: input.description,
        url: input.url,
        btntxt: input.btntxt ?? "进入系统"
      },
      enable_id_trans: 0,
      enable_duplicate_check: 0,
      duplicate_check_interval: 1800
    })
  });
  if (!response.ok) return { errcode: response.status, errmsg: `http_${response.status}` };
  const payload = (await response.json().catch(() => ({}))) as WecomSendResult;
  return payload;
}
