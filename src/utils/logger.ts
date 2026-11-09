/**
 * 分级 subsystem 日志。对应真实 OpenClaw 的 utils/logger.ts。
 *
 * - 级别由环境变量 MINI_OPENCLAW_LOG_LEVEL 控制（debug|info|warn|error，默认 info）
 * - 输出到 **stderr**，不污染 stdout 的流式回复
 * - 非 TTY / 设置 NO_COLOR 时自动关闭颜色
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const colors = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
  magenta: "\u001b[35m",
  gray: "\u001b[90m",
};

const useColor = process.stderr.isTTY === true && !process.env.NO_COLOR;

function currentLevelWeight(): number {
  const raw = (process.env.MINI_OPENCLAW_LOG_LEVEL ?? "info").toLowerCase();
  return LEVEL_WEIGHT[raw as LogLevel] ?? LEVEL_WEIGHT.info;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export function createLogger(subsystem: string): Logger {
  const write = (level: LogLevel, color: string, msg: string, args: unknown[]): void => {
    if (LEVEL_WEIGHT[level] < currentLevelWeight()) return;
    const head = `${colors.dim}${timestamp()}${colors.reset} ${color}${level.toUpperCase().padEnd(5)}${colors.reset} ${colors.cyan}[${subsystem}]${colors.reset} `;
    process.stderr.write(`${useColor ? head : head.replace(/\u001b\[\d+m/g, "")}${msg}\n`);
    for (const arg of args) {
      const rendered = arg instanceof Error ? `${arg.message}\n${arg.stack ?? ""}` : String(arg);
      process.stderr.write(`${rendered}\n`);
    }
  };

  return {
    debug: (msg, ...args) => write("debug", colors.gray, msg, args),
    info: (msg, ...args) => write("info", colors.green, msg, args),
    warn: (msg, ...args) => write("warn", colors.yellow, msg, args),
    error: (msg, ...args) => write("error", colors.red, msg, args),
  };
}
