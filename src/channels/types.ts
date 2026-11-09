/**
 * 渠道（Channel）抽象。
 *
 * 对应真实 OpenClaw 的 channels/ 插件体系：每个渠道（WhatsApp / Telegram / CLI ...）
 * 只要实现这套接口，就能被 Gateway 统一接入。
 */

/** 渠道 → Gateway 的入站消息 */
export interface IncomingMessage {
  /** 渠道实例 id，例如 "cli" */
  channelId: string;
  /** 渠道类型，例如 "cli" / "telegram" */
  channelType: string;
  /** 账号 id，例如 "default" */
  accountId: string;
  /** 会话/对话 id，例如 "default" 或某个群 id */
  conversationId: string;
  /** 发送者 id */
  senderId: string;
  /** 消息正文 */
  text: string;
  /** 时间戳 */
  timestamp: number;
  /** 渠道级指令（如 /new），若存在则 Gateway 优先处理 */
  command?: string;
}

/** Gateway → 渠道的出站载荷 */
export interface ReplyPayload {
  /** partial=流式增量块；block=完整块；status=状态提示；final=最终态；error=错误 */
  kind: "partial" | "block" | "status" | "error";
  text: string;
  meta?: Record<string, unknown>;
}

/** 渠道能力声明：决定 Gateway 如何把流式输出回传 */
export interface ChannelCapabilities {
  /**
   * 流式回传方式：
   *  - "raw"   终端类渠道，逐 token 直接渲染（不做分块，避免打断单词）
   *  - "block" IM 类渠道，把文本按句/段落分块，作为独立消息发送
   */
  streaming?: "raw" | "block";
}

/** 渠道接口：实现它即可接入 OpenClaw 网关 */
export interface Channel {
  readonly id: string;
  readonly type: string;
  /** 可选：渠道能力声明。默认 streaming = "block" */
  readonly capabilities?: ChannelCapabilities;
  /** 启动渠道，把收到的消息交给 handler */
  start(handler: (msg: IncomingMessage) => Promise<void>): Promise<void>;
  /** 停止渠道 */
  stop(): Promise<void>;
  /** 向指定会话发送回执 */
  send(conversationId: string, payload: ReplyPayload): Promise<void>;
}
