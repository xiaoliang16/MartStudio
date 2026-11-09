/**
 * 会话键解析。对应真实 OpenClaw 的 gateway/session-key.ts。
 *
 * 会话键是「逻辑会话」的唯一标识：同一渠道的同一对话 → 同一个 JSONL 会话文件。
 * 格式：`<profile>:<channelType>:<conversationId>`，例如 `main:cli:default`。
 */
import type { IncomingMessage } from "../channels/types.js";

export function resolveSessionKey(msg: IncomingMessage): string {
  return `main:${msg.channelType}:${msg.conversationId}`;
}
