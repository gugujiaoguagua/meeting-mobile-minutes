import crypto from "node:crypto";
import { getWecomCallbackEncodingAesKey, getWecomCallbackReceiveId, getWecomCallbackToken } from "@/lib/wecomConfig";

export type WecomCallbackMessage = {
  toUserName?: string;
  fromUserName?: string;
  createTime?: string;
  msgType?: string;
  event?: string;
  eventKey?: string;
  content?: string;
  msgId?: string;
  agentId?: string;
  rawXml: string;
};

export type WecomCallbackDecryptResult = {
  messageXml: string;
  receiveId: string;
};

type WecomCallbackConfig = {
  token: string;
  encodingAesKey: string;
  receiveId: string;
};

function getRequiredCallbackConfig(): WecomCallbackConfig {
  const token = getWecomCallbackToken().trim();
  const encodingAesKey = getWecomCallbackEncodingAesKey().trim();
  const receiveId = getWecomCallbackReceiveId().trim();

  if (!token || !encodingAesKey) {
    throw new Error("wecom_callback_not_configured");
  }
  if (encodingAesKey.length !== 43) {
    throw new Error("invalid_wecom_callback_encoding_aes_key");
  }

  return { token, encodingAesKey, receiveId };
}

function timingSafeEqualString(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function createWecomCallbackSignature(token: string, timestamp: string, nonce: string, encrypted: string) {
  return crypto.createHash("sha1").update([token, timestamp, nonce, encrypted].sort().join("")).digest("hex");
}

export function verifyWecomCallbackSignature(params: {
  token: string;
  timestamp: string;
  nonce: string;
  encrypted: string;
  msgSignature: string;
}) {
  const expected = createWecomCallbackSignature(params.token, params.timestamp, params.nonce, params.encrypted);
  return timingSafeEqualString(expected, params.msgSignature);
}

function getAesKey(encodingAesKey: string) {
  const aesKey = Buffer.from(`${encodingAesKey}=`, "base64");
  if (aesKey.length !== 32) throw new Error("invalid_wecom_callback_aes_key");
  return aesKey;
}

function stripPkcs7Padding(buffer: Buffer) {
  const padLength = buffer[buffer.length - 1];
  if (padLength < 1 || padLength > 32) throw new Error("invalid_wecom_callback_padding");
  return buffer.subarray(0, buffer.length - padLength);
}

export function decryptWecomCallbackPayload(encrypted: string, encodingAesKey: string, expectedReceiveId = ""): WecomCallbackDecryptResult {
  const aesKey = getAesKey(encodingAesKey);
  const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, aesKey.subarray(0, 16));
  decipher.setAutoPadding(false);

  const decrypted = stripPkcs7Padding(Buffer.concat([decipher.update(encrypted, "base64"), decipher.final()]));
  if (decrypted.length < 20) throw new Error("invalid_wecom_callback_payload");

  const messageLength = decrypted.readUInt32BE(16);
  const messageStart = 20;
  const messageEnd = messageStart + messageLength;
  if (messageEnd > decrypted.length) throw new Error("invalid_wecom_callback_message_length");

  const messageXml = decrypted.subarray(messageStart, messageEnd).toString("utf8");
  const receiveId = decrypted.subarray(messageEnd).toString("utf8");
  if (expectedReceiveId && receiveId && receiveId !== expectedReceiveId) {
    throw new Error("wecom_callback_receive_id_mismatch");
  }

  return { messageXml, receiveId };
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

export function extractXmlValue(xml: string, tagName: string) {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tagName}>`, "i");
  const match = xml.match(pattern);
  const value = match?.[1] ?? match?.[2];
  return typeof value === "string" ? decodeXmlEntities(value.trim()) : "";
}

export function parseWecomCallbackMessage(xml: string): WecomCallbackMessage {
  return {
    toUserName: extractXmlValue(xml, "ToUserName") || undefined,
    fromUserName: extractXmlValue(xml, "FromUserName") || undefined,
    createTime: extractXmlValue(xml, "CreateTime") || undefined,
    msgType: extractXmlValue(xml, "MsgType") || undefined,
    event: extractXmlValue(xml, "Event") || undefined,
    eventKey: extractXmlValue(xml, "EventKey") || undefined,
    content: extractXmlValue(xml, "Content") || undefined,
    msgId: extractXmlValue(xml, "MsgId") || undefined,
    agentId: extractXmlValue(xml, "AgentID") || undefined,
    rawXml: xml
  };
}

export function verifyAndDecryptWecomCallback(params: {
  encrypted: string;
  timestamp: string;
  nonce: string;
  msgSignature: string;
}) {
  const config = getRequiredCallbackConfig();
  if (!verifyWecomCallbackSignature({ ...params, token: config.token })) {
    throw new Error("wecom_callback_signature_mismatch");
  }
  return decryptWecomCallbackPayload(params.encrypted, config.encodingAesKey, config.receiveId);
}
