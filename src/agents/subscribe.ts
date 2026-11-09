/**
 * 会话事件订阅与分发。对应真实 OpenClaw 的 pi-embedded-subscribe.ts。
 *
 * pi 的 AgentSession 会持续 emit 事件（message_start / message_update / tool_execution_* /
 * turn_* / agent_end ...）。OpenClaw 把这些事件翻译成"渠道可消费的动作"：
 *   · 文本增量  → 流式 partial reply
 *   · 完整文本块 → block reply（避免 token 级刷屏）
 *   · 工具执行   → onToolResult（用于 UI 显示"正在调用 xx 工具"）
 *   · agent_end  → 收尾
 */
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { BlockChunker } from "../utils/block-chunker.js";
import { createLogger } from "../utils/logger.js";
import type { ToolResultEvent } from "./types.js";

const log = createLogger("subscribe");

export interface SubscribeEmbeddedPiSessionParams {
  session: AgentSession;
  runId: string;
  /** token 级增量 */
  onPartialReply?: (delta: string) => void;
  /** 完整文本块 */
  onBlockReply?: (payload: { text: string }) => void | Promise<void>;
  /** 工具执行进度 */
  onToolResult?: (event: ToolResultEvent) => void;
  /** 一轮结束 */
  onAgentEnd?: () => void;
  /** 是否做流式分块（默认 true，IM 渠道建议开） */
  chunkStreaming?: boolean;
  /** 是否打印调试事件 */
  verbose?: boolean;
}

export interface EmbeddedPiSubscription {
  dispose(): void;
}

export function subscribeEmbeddedPiSession(
  params: SubscribeEmbeddedPiSessionParams,
): EmbeddedPiSubscription {
  const chunker = new BlockChunker();
  const useChunker = params.chunkStreaming ?? true;

  let sawText = false;

  const emitBlocks = async (blocks: string[]) => {
    for (const b of blocks) {
      await params.onBlockReply?.({ text: b });
    }
  };

  const handle = async (event: AgentSessionEvent): Promise<void> => {
    if (params.verbose) log.debug(`event: ${event.type}`);

    switch (event.type) {
      case "message_update": {
        const ame = event.assistantMessageEvent;
        if (ame?.type === "text_delta") {
          sawText = true;
          params.onPartialReply?.(ame.delta);
          if (useChunker) {
            await emitBlocks(chunker.push(ame.delta));
          }
        }
        break;
      }

      case "tool_execution_start":
        params.onToolResult?.({
          phase: "start",
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          args: event.args,
        });
        break;

      case "tool_execution_update":
        params.onToolResult?.({
          phase: "update",
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          args: event.args,
          result: event.partialResult,
        });
        break;

      case "tool_execution_end":
        params.onToolResult?.({
          phase: "end",
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          result: event.result,
          isError: event.isError,
        });
        break;

      case "agent_end": {
        // 冲刷残留文本
        if (useChunker) await emitBlocks(chunker.flush());
        params.onAgentEnd?.();
        break;
      }

      default:
        break;
    }
  };

  const unsubscribe = params.session.subscribe((event) => {
    // 事件处理里可能有 await，用 void + catch 避免阻塞 agent 循环
    void handle(event).catch((err) => {
      log.error(`事件处理失败 (${event.type}):`, err);
    });
  });

  return {
    dispose: () => {
      if (!sawText) log.debug("本轮没有文本输出");
      unsubscribe();
    },
  };
}
