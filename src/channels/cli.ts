/**
 * CLI 渠道。对应真实 OpenClaw 的本地 TUI / 终端入口。
 *
 * 它是 Channel 接口的一个具体实现：从 stdin 读消息，把 Gateway 回传的
 * ReplyPayload 渲染到 stdout。换成 Telegram / Discord 只需要再写一个实现。
 */
import { createInterface, type Interface } from "node:readline";
import type { Channel, IncomingMessage, ReplyPayload } from "./types.js";
import { colors, createLogger } from "../utils/logger.js";

const log = createLogger("channel:cli");

export interface CliChannelOptions {
  id?: string;
  accountId?: string;
  conversationId?: string;
  senderId?: string;
  /** 一次性模式：只处理这一条消息然后退出 */
  oneShotPrompt?: string;
  /** 关闭颜色（CI / 重定向时） */
  noColor?: boolean;
}

export class CliChannel implements Channel {
  readonly id: string;
  readonly type = "cli";
  /** 终端逐 token 直接渲染，不做分块 */
  readonly capabilities = { streaming: "raw" as const };

  private readonly accountId: string;
  private readonly conversationId: string;
  private readonly senderId: string;
  private readonly oneShotPrompt?: string;
  private readonly useColor: boolean;

  private rl?: Interface;
  /** 当前是否停在一行中间（用于流式输出后补换行） */
  private lineOpen = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: CliChannelOptions = {}) {
    this.id = options.id ?? "cli";
    this.accountId = options.accountId ?? "default";
    this.conversationId = options.conversationId ?? "default";
    this.senderId = options.senderId ?? "local-user";
    this.oneShotPrompt = options.oneShotPrompt;
    this.useColor = !options.noColor && process.stdout.isTTY !== false;
  }

  async start(handler: (msg: IncomingMessage) => Promise<void>): Promise<void> {
    if (this.oneShotPrompt) {
      await this.runOneShot(handler);
      return;
    }
    await this.runInteractive(handler);
  }

  /** 一次性执行：适合脚本 / 演示 / 管道 */
  private async runOneShot(handler: (msg: IncomingMessage) => Promise<void>): Promise<void> {
    this.printBannerOnce();
    this.writeUserEcho(this.oneShotPrompt!);
    await handler(this.buildMessage(this.oneShotPrompt!));
    // 等待所有渲染任务落盘
    await this.writeQueue;
    this.ensureNewline();
  }

  /** 交互模式：readline 循环 */
  private async runInteractive(handler: (msg: IncomingMessage) => Promise<void>): Promise<void> {
    this.printBannerOnce();
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      // 非 TTY（管道/重定向）时关闭 terminal 模式，避免重复回显输入
      terminal: process.stdin.isTTY === true,
    });
    this.prompt();

    for await (const line of this.rl) {
      const text = line.trim();
      if (text.length === 0) {
        this.prompt();
        continue;
      }
      this.ensureNewline();
      try {
        await handler(this.buildMessage(text));
        await this.writeQueue;
      } catch (err) {
        this.writeLine(this.c(colors.red, `错误：${err instanceof Error ? err.message : String(err)}`));
      }
      this.ensureNewline();
      this.prompt();
    }
    this.ensureNewline();
  }

  /** 显示输入提示符（提示符本身占一行，后续输出前会补换行） */
  private prompt(): void {
    if (!this.rl) return;
    this.rl.setPrompt(this.c(colors.cyan, "you › "));
    this.rl.prompt();
    this.lineOpen = true;
  }

  async stop(): Promise<void> {
    this.rl?.close();
  }

  async send(_conversationId: string, payload: ReplyPayload): Promise<void> {
    switch (payload.kind) {
      case "partial": {
        // 流式增量：直接写，不换行
        this.write(payload.text);
        break;
      }
      case "block": {
        // 一个逻辑块结束 → 补换行（文本本体已通过 partial 输出过）
        this.ensureNewline();
        break;
      }
      case "status": {
        this.ensureNewline();
        this.writeLine(this.c(colors.gray, payload.text));
        break;
      }
      case "error": {
        this.ensureNewline();
        this.writeLine(this.c(colors.red, `✖ ${payload.text}`));
        break;
      }
    }
  }

  // ---------- 渲染 helpers ----------

  private buildMessage(text: string): IncomingMessage {
    return {
      channelId: this.id,
      channelType: this.type,
      accountId: this.accountId,
      conversationId: this.conversationId,
      senderId: this.senderId,
      text,
      timestamp: Date.now(),
    };
  }

  private writeUserEcho(text: string): void {
    this.ensureNewline();
    this.writeLine(`${this.c(colors.cyan, "you ›")} ${text}`);
  }

  private printBannerOnce(): void {
    if (process.env.MINI_OPENCLAW_QUIET === "1") return;
    const banner = [
      "",
      this.c(colors.magenta, "  ╭──────────────────────────────────────────────╮"),
      this.c(colors.magenta, "  │") + "        🦞  Mini-OpenClaw  (pi Agent SDK)      " + this.c(colors.magenta, "│"),
      this.c(colors.magenta, "  ╰──────────────────────────────────────────────╯"),
      "",
      this.c(colors.gray, "  输入消息开始对话，/help 查看命令，/exit 退出。"),
      "",
    ].join("\n");
    this.writeLine(banner);
  }

  private write(text: string): void {
    process.stdout.write(text);
    this.lineOpen = !text.endsWith("\n") ? true : false;
  }

  private writeLine(text: string): void {
    process.stdout.write(`${text}\n`);
    this.lineOpen = false;
  }

  private ensureNewline(): void {
    if (this.lineOpen) {
      process.stdout.write("\n");
      this.lineOpen = false;
    }
  }

  private c(color: string, text: string): string {
    return this.useColor ? `${color}${text}${colors.reset}` : text;
  }
}
