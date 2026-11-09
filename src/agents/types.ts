/**
 * Agent 运行层的类型定义。
 *
 * Gateway 只依赖这里的类型 + runEmbeddedPiAgent()，完全不接触 pi SDK 的具体类 ——
 * 对应真实 OpenClaw 的 agents/types.ts。
 */
import type { ModelRuntime, SessionManager, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

/** 工具执行进度事件（start → update* → end） */
export interface ToolResultEvent {
  phase: "start" | "update" | "end";
  toolName: string;
  toolCallId: string;
  /** start/update 阶段的工具入参 */
  args?: unknown;
  /** update 阶段的部分结果 / end 阶段的最终结果 */
  result?: unknown;
  isError?: boolean;
}

/** 一次嵌入式 pi 运行的全部输入（由 Gateway 装配） */
export interface RunEmbeddedPiAgentParams {
  runId: string;
  sessionId: string;
  sessionKey: string;
  sessionFile: string;

  workspaceDir: string;
  agentDir: string;

  prompt: string;
  /** 动态 system prompt（完整替换 pi 默认） */
  systemPrompt?: string;

  model: Model<any>;
  thinkingLevel?: ThinkingLevel;
  /** pi 1.x 的统一模型/凭据运行时（取代 0.x 的 authStorage + modelRegistry） */
  modelRuntime?: ModelRuntime;

  /** 工具白名单：内置工具名 + 自定义工具名（缺一不可，白名单语义） */
  activeToolNames: string[];
  customTools: ToolDefinition[];

  sessionManager: SessionManager;

  /** raw=终端逐 token；block=IM 按句/段分块 */
  streamingMode?: "raw" | "block";

  onPartialReply?: (delta: string) => void;
  onBlockReply?: (payload: { text: string }) => void | Promise<void>;
  onToolResult?: (event: ToolResultEvent) => void;
  onAgentEnd?: () => void;
}

/** 运行结果（失败不抛异常，落回结果对象 —— 渠道侧只认这个） */
export interface EmbeddedPiRunResult {
  runId: string;
  sessionId: string;
  sessionFile: string;
  ok: boolean;
  elapsedMs: number;
  error?: string;
}
