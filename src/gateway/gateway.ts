/**
 * Gateway —— 消息网关。对应真实 OpenClaw 的 Gateway 层。
 *
 * 它是所有渠道的统一入口，职责：
 *   1. 接收渠道来的消息，解析会话键
 *   2. 处理内置命令（/new /tools /status）
 *   3. 按会话键**串行**排队
 *   4. 装配本次运行所需的一切（system prompt / 工具 / 会话）
 *   5. 调用嵌入式 pi runner，把事件流回传渠道
 *
 * 渠道对 Agent 一无所知，Agent 对渠道也一无所知 —— 全靠 Gateway 粘合。
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { loadStyleEngine } from "../agents/style-engine.js";
import type { StyleEngine } from "../agents/style-engine.js";
import type { Channel, IncomingMessage, ReplyPayload } from "../channels/types.js";
import type { ModelLayer } from "../agents/model.js";
import { runEmbeddedPiAgent } from "../agents/pi-runner.js";
import { listSessionFiles, newSession, openSession } from "../agents/session-store.js";
import { buildAgentSystemPrompt } from "../agents/system-prompt.js";
import { toToolDefinitions } from "../agents/tool-adapter.js";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { loadCatalog } from "../agents/catalog.js";
import { createCatalogTools } from "../agents/catalog-tools.js";
import { createCopyTool } from "../agents/copy-tools.js";
import { createScenarioTool } from "../agents/scenario-tools.js";
import type { CustomTool } from "../agents/tools.js";
import type { MiniOpenClawConfig } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { RunQueue } from "./run-queue.js";
import { resolveSessionKey } from "./session-key.js";

const log = createLogger("gateway");

export interface GatewayOptions {
  cfg: MiniOpenClawConfig;
  modelLayer: ModelLayer;
  /** 显示用：模型标签 */
  modelLabel: string;
}

export class Gateway {
  private readonly channels = new Map<string, Channel>();
  private readonly queue = new RunQueue();
  private readonly cfg: MiniOpenClawConfig;
  private readonly modelLayer: ModelLayer;
  private readonly modelLabel: string;
  /** 风格引擎(构造即加载 styles.yaml——数据坏则启动失败,fail-fast) */
  private readonly styles: StyleEngine;
  /** 业务工具(start 时装配) */
  private businessTools: CustomTool[] = [];
  private businessToolDefs: ToolDefinition[] = [];
  /** 每次场景选择的审计记录(rationale 日志的数据源,eval 回归读取)。进程级累计,无上限 */
  readonly scenarioSelections: Array<{ scenarioId: string; rationale: string; at: string }> = [];

  /** 统计信息，供 /status 使用 */
  readonly stats = { messagesIn: 0, runs: 0, runsFailed: 0, toolCalls: 0 };

  constructor(options: GatewayOptions) {
    this.cfg = options.cfg;
    this.modelLayer = options.modelLayer;
    this.modelLabel = options.modelLabel;
    this.styles = loadStyleEngine(join(this.cfg.dataDir, "styles.yaml"));
  }

  registerChannel(channel: Channel): void {
    this.channels.set(channel.id, channel);
    log.info(`渠道已注册：${channel.id} (type=${channel.type})`);
  }

  async start(): Promise<void> {
    const catalog = loadCatalog(join(this.cfg.dataDir, "products.json"));
    this.businessTools = [
      ...createCatalogTools(catalog, this.styles),
      ...createScenarioTool(this.styles, (scenarioId, rationale) => {
        this.scenarioSelections.push({ scenarioId, rationale, at: new Date().toISOString() });
        log.info(`场景选择：${scenarioId}（理由：${rationale}）`);
      }),
      ...createCopyTool(this.cfg.copiesDir),
    ];
    this.businessToolDefs = toToolDefinitions(this.businessTools);
    if (!this.cfg.enableCustomTools) {
      log.warn("enableCustomTools=false:业务工具未注入,但 system prompt 的必走流程/场景规则仍会下发——如非刻意,请开启该开关");
    }

    for (const channel of this.channels.values()) {
      await channel.start((msg) => this.handleIncoming(msg));
    }
    log.info(
      `Gateway 已启动，渠道数=${this.channels.size}，业务工具=${this.businessTools.map((t) => t.name).join(",")}`,
    );
  }

  async stop(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.stop();
    }
    log.info("Gateway 已停止");
  }

  /** 渠道入站消息的统一处理入口 */
  async handleIncoming(msg: IncomingMessage): Promise<void> {
    this.stats.messagesIn++;
    const text = msg.text.trim();

    // ---- 内置命令 ----
    if (text.startsWith("/")) {
      await this.handleCommand(msg, text);
      return;
    }
    if (text.length === 0) return;

    const sessionKey = resolveSessionKey(msg);
    log.debug(`收到消息 channel=${msg.channelType} conv=${msg.conversationId} key=${sessionKey}`);

    // ---- 按会话键串行执行 ----
    await this.queue.enqueue(sessionKey, () => this.runTurn(msg, sessionKey, text));
  }

  private async handleCommand(msg: IncomingMessage, text: string): Promise<void> {
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    const sessionKey = resolveSessionKey(msg);

    switch (cmd) {
      case "new": {
        const handle = newSession(this.cfg, sessionKey);
        await this.reply(msg, {
          kind: "status",
          text: `🆕 已开启新会话：${handle.file.split("/").pop()}`,
        });
        return;
      }
      case "sessions": {
        const files = listSessionFiles(this.cfg, sessionKey);
        await this.reply(msg, {
          kind: "status",
          text:
            files.length === 0
              ? "（还没有任何会话文件）"
              : `共有 ${files.length} 个会话文件：\n` + files.map((f) => `· ${f.split("/").pop()}`).join("\n"),
        });
        return;
      }
      case "tools": {
        const names = [
          ...this.cfg.builtInTools,
          ...(this.cfg.enableCustomTools ? this.businessTools.map((t) => t.name) : []),
        ];
        await this.reply(msg, { kind: "status", text: `🔧 可用工具：${names.join(", ")}` });
        return;
      }
      case "status": {
        await this.reply(msg, {
          kind: "status",
          text: [
            `模型：${this.modelLabel}`,
            `会话键：${sessionKey}`,
            `工作区：${this.cfg.workspaceDir}`,
            `收到的消息：${this.stats.messagesIn}`,
            `运行次数：${this.stats.runs}（失败 ${this.stats.runsFailed}）`,
            `工具调用：${this.stats.toolCalls}`,
          ].join("\n"),
        });
        return;
      }
      case "help": {
        await this.reply(msg, {
          kind: "status",
          text: [
            "可用命令：",
            "  /new       开启新会话",
            "  /sessions  列出历史会话文件",
            "  /tools     查看可用工具",
            "  /status    查看运行状态",
            "  /help      显示帮助",
            "  /exit      退出",
          ].join("\n"),
        });
        return;
      }
      case "exit":
      case "quit": {
        await this.reply(msg, { kind: "status", text: "👋 再见" });
        await this.stop();
        process.exit(0);
        return;
      }
      default: {
        await this.reply(msg, { kind: "error", text: `未知命令：/${cmd}（输入 /help 查看帮助）` });
        return;
      }
    }
  }

  /** 执行一轮 Agent 对话 */
  private async runTurn(msg: IncomingMessage, sessionKey: string, text: string): Promise<void> {
    const runId = randomUUID();
    const session = openSession(this.cfg, sessionKey);

    // 业务工具（start 时装配；enableCustomTools 是总开关）
    const customTools = this.cfg.enableCustomTools ? this.businessToolDefs : [];

    const toolNames = [
      ...this.cfg.builtInTools,
      ...customTools.map((t) => t.name),
    ];

    const systemPrompt = buildAgentSystemPrompt({
      cfg: this.cfg,
      channelType: msg.channelType,
      conversationId: msg.conversationId,
      sessionKey,
      toolNames,
      modelLabel: this.modelLabel,
      styles: this.styles,
    });

    this.stats.runs++;
    log.info(`运行 ${runId.slice(0, 8)} → key=${sessionKey} prompt="${truncate(text, 40)}"`);

    // 终端类渠道用原始流；IM 类渠道用分块（作为独立消息发送）
    const streamingMode = this.channelFor(msg.channelId).capabilities?.streaming ?? "block";

    const result = await runEmbeddedPiAgent({
      runId,
      sessionId: session.id,
      sessionKey,
      sessionFile: session.file,
      workspaceDir: this.cfg.workspaceDir,
      agentDir: this.cfg.agentDir,
      prompt: text,
      systemPrompt,
      model: this.modelLayer.model,
      thinkingLevel: this.cfg.model.thinkingLevel,
      modelRuntime: this.modelLayer.modelRuntime,
      activeToolNames: toolNames,
      customTools,
      sessionManager: session.manager,
      streamingMode,

      onPartialReply: (delta) => {
        void this.reply(msg, { kind: "partial", text: delta });
      },
      onBlockReply: ({ text: blockText }) => {
        void this.reply(msg, { kind: "block", text: blockText });
      },
      onToolResult: (event) => {
        if (event.phase === "start") {
          this.stats.toolCalls++;
          void this.reply(msg, { kind: "status", text: `🔧 调用工具 ${event.toolName} ${formatArgs(event.args)}` });
        } else if (event.phase === "end") {
          void this.reply(msg, {
            kind: "status",
            text: `✅ 工具 ${event.toolName} ${event.isError ? "执行出错" : "完成"}`,
          });
        }
      },
      onAgentEnd: () => {
        void this.reply(msg, { kind: "block", text: "" });
      },
    });

    if (!result.ok) {
      this.stats.runsFailed++;
      await this.reply(msg, { kind: "error", text: `运行失败：${result.error}` });
      return;
    }
    log.debug(`运行 ${runId.slice(0, 8)} 完成，耗时 ${result.elapsedMs}ms`);
  }

  private channelFor(channelId: string): Channel {
    const ch = this.channels.get(channelId);
    if (!ch) throw new Error(`渠道未注册：${channelId}`);
    return ch;
  }

  private async reply(msg: IncomingMessage, payload: ReplyPayload): Promise<void> {
    try {
      await this.channelFor(msg.channelId).send(msg.conversationId, payload);
    } catch (err) {
      log.error(`回传失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function formatArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  try {
    const s = JSON.stringify(args);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  } catch {
    return "";
  }
}
