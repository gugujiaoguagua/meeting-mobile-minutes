import { NextResponse } from "next/server";
import { extractXmlValue, parseWecomCallbackMessage, verifyAndDecryptWecomCallback } from "@/lib/wecomCallback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function textResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

function getRequiredSearchParam(url: URL, name: string) {
  return url.searchParams.get(name)?.trim() || "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const encrypted = getRequiredSearchParam(url, "echostr");
  const timestamp = getRequiredSearchParam(url, "timestamp");
  const nonce = getRequiredSearchParam(url, "nonce");
  const msgSignature = getRequiredSearchParam(url, "msg_signature");

  if (!encrypted || !timestamp || !nonce || !msgSignature) {
    return textResponse("missing callback verification params", 400);
  }

  try {
    const result = verifyAndDecryptWecomCallback({ encrypted, timestamp, nonce, msgSignature });
    return textResponse(result.messageXml);
  } catch (error) {
    console.warn("wecom_callback_verify_failed", { message: error instanceof Error ? error.message : "unknown_error" });
    return textResponse("forbidden", 403);
  }
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const timestamp = getRequiredSearchParam(url, "timestamp");
  const nonce = getRequiredSearchParam(url, "nonce");
  const msgSignature = getRequiredSearchParam(url, "msg_signature");
  const body = await request.text();
  const encrypted = extractXmlValue(body, "Encrypt");

  if (!encrypted || !timestamp || !nonce || !msgSignature) {
    return textResponse("missing callback message params", 400);
  }

  try {
    const result = verifyAndDecryptWecomCallback({ encrypted, timestamp, nonce, msgSignature });
    const message = parseWecomCallbackMessage(result.messageXml);

    console.info("wecom_callback_received", {
      msgType: message.msgType,
      event: message.event,
      fromUserName: message.fromUserName,
      agentId: message.agentId,
      msgId: message.msgId,
      receiveId: result.receiveId
    });

    return textResponse("success");
  } catch (error) {
    console.warn("wecom_callback_receive_failed", { message: error instanceof Error ? error.message : "unknown_error" });
    return textResponse("forbidden", 403);
  }
}
