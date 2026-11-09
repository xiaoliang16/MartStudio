/**
 * 录制渠道。对应真实 OpenClaw 测试体系里的 recording channel。
 *
 * 不接任何真实 I/O：把消息直接注入 handler、把回执分类记录下来，
 * 供自动化演示（scripts/demo.ts）与测试断言使用。
 *
 * type 默认为 "demo" → 会话键形如 main:demo:<conversationId>。
 */
import type { Channel, IncomingMessage, ReplyPayload } from "./types.js";

export interface RecordingChannelOptions {
  id?: string;
  type?: string;
  conversationId?: string;
  senderId?: string;
}

interface RecordingState {
  partials: string[];
  blocks: string[];
  statuses: string[];
  errors: string[];
}

export class RecordingChannel implements Channel {
  readonly id: string;
  readonly type: string;
  readonly capabilities = { streaming: "block" as const };

  private readonly conversationId: string;
  private readonly senderId: string;
  private handler?: (msg: IncomingMessage) => Promise<void>;
  private state: RecordingState = { partials: [], blocks: [], statuses: [], errors: [] };

  constructor(options: RecordingChannelOptions = {}) {
    this.id = options.id ?? "recording";
    this.type = options.type ?? "demo";
    this.conversationId = options.conversationId ?? "default";
    this.senderId = options.senderId ?? "demo-user";
  }

  async start(handler: (msg: IncomingMessage) => Promise<void>): Promise<void> {
    this.handler = handler;
  }

  async stop(): Promise<void> {
    this.handler = undefined;
  }

  async send(_conversationId: string, payload: ReplyPayload): Promise<void> {
    switch (payload.kind) {
      case "partial":
        this.state.partials.push(payload.text);
        break;
      case "block":
        // agent_end 时 Gateway 会补一个空 block 作为终止符，不记入内容
        if (payload.text.length > 0) this.state.blocks.push(payload.text);
        break;
      case "status":
        this.state.statuses.push(payload.text);
        break;
      case "error":
        this.state.errors.push(payload.text);
        this.state.statuses.push(`✖ ${payload.text}`);
        break;
    }
  }

  /** 模拟用户输入一条消息，等待整轮处理完成 */
  async inject(text: string): Promise<void> {
    if (!this.handler) throw new Error("渠道尚未 start()，无法注入消息");
    await this.handler({
      channelId: this.id,
      channelType: this.type,
      accountId: "default",
      conversationId: this.conversationId,
      senderId: this.senderId,
      text,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.state = { partials: [], blocks: [], statuses: [], errors: [] };
  }

  partials(): string[] {
    return [...this.state.partials];
  }

  blocks(): string[] {
    return [...this.state.blocks];
  }

  statuses(): string[] {
    return [...this.state.statuses];
  }

  errors(): string[] {
    return [...this.state.errors];
  }
}
