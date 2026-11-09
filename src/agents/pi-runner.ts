/**
 * 嵌入式 Pi Agent 运行器。对应真实 OpenClaw 的 pi-embedded-runner/run.ts。
 *
 * 这是整个项目的"心脏"。它做的事情与 OpenClaw 完全一致：
 *   1. 用 createAgentSession() 直接实例化 pi 的 AgentSession（不是子进程、不是 RPC）
 *   2. 通过 DefaultResourceLoader 注入动态 system prompt
 *   3. 通过 customTools 注入自定义工具
 *   4. 挂上事件订阅，把流式输出翻译成渠道回调
 *   5. 调用 session.prompt() 触发 Agent Loop
 *
 * 会话是"每次运行重建、状态落在 JSONL"的模式 —— 与 OpenClaw 的嵌入式调用一致。
 */
import {
  createAgentSession,
  DefaultResourceLoader,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createLogger } from "../utils/logger.js";
import { subscribeEmbeddedPiSession } from "./subscribe.js";
import { createSystemPromptOverride } from "./system-prompt.js";
import type { EmbeddedPiRunResult, RunEmbeddedPiAgentParams } from "./types.js";

const log = createLogger("pi-runner");

export async function runEmbeddedPiAgent(
  params: RunEmbeddedPiAgentParams,
): Promise<EmbeddedPiRunResult> {
  const started = Date.now();
  const base = {
    runId: params.runId,
    sessionId: params.sessionId,
    sessionFile: params.sessionFile,
  };

  try {
    // ---- 1. 设置与资源加载 ----
    const settingsManager = SettingsManager.inMemory();
    const resourceLoader = new DefaultResourceLoader({
      cwd: params.workspaceDir,
      agentDir: params.agentDir,
      settingsManager,
      // 迷你版：关掉磁盘上的扩展/技能/提示模板/主题/上下文文件自动发现，
      // 让行为完全由代码决定（真实 OpenClaw 是开启并做策略过滤的）
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      // 动态 system prompt —— 对应 OpenClaw 的 applySystemPromptOverrideToSession
      systemPromptOverride: createSystemPromptOverride(params.systemPrompt),
    });
    await resourceLoader.reload();

    // ---- 2. 创建 AgentSession（嵌入式）----
    const { session, modelFallbackMessage } = await createAgentSession({
      cwd: params.workspaceDir,
      agentDir: params.agentDir,
      modelRuntime: params.modelRuntime,
      model: params.model,
      thinkingLevel: params.thinkingLevel,
      // 工具白名单：内置工具名 + 自定义工具名（白名单语义，缺一不可）
      tools: params.activeToolNames,
      // 自定义工具走 ToolDefinition[]
      customTools: params.customTools,
      sessionManager: params.sessionManager,
      settingsManager,
      resourceLoader,
    });

    if (modelFallbackMessage) log.warn(`模型回退提示：${modelFallbackMessage}`);

    log.debug(
      `会话已创建 sessionId=${session.sessionId} tools=[${session.getActiveToolNames().join(", ")}]`,
    );

    // ---- 3. 订阅事件 → 渠道回调 ----
    const subscription = subscribeEmbeddedPiSession({
      session,
      runId: params.runId,
      onPartialReply: params.onPartialReply,
      onBlockReply: params.onBlockReply,
      onToolResult: params.onToolResult,
      onAgentEnd: params.onAgentEnd,
      // 终端渠道用 raw（不分块）；IM 渠道用 block（按句/段分块）
      chunkStreaming: (params.streamingMode ?? "block") === "block",
      verbose: process.env.MINI_OPENCLAW_LOG_LEVEL === "debug",
    });

    // ---- 4. 触发 Agent Loop ----
    try {
      await session.prompt(params.prompt);
    } finally {
      subscription.dispose();
    }

    return { ...base, ok: true, elapsedMs: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`运行失败：${message}`);
    return { ...base, ok: false, elapsedMs: Date.now() - started, error: message };
  }
}
