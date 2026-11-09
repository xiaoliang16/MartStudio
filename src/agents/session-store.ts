/**
 * 会话存储层。对应真实 OpenClaw 的 session-manager-init.ts + session-manager-cache.ts。
 *
 * 职责：
 *  1. 把「会话键」(sessionKey) 映射到磁盘上的 JSONL 会话文件
 *  2. 缓存 SessionManager 实例，避免重复解析同一个文件
 *  3. 支持 /new —— 为同一会话键开一个新文件（旧文件保留，可回溯）
 *
 * JSONL 里每个 entry 通过 id + parentId 串成一棵树，天然支持分支与压缩。
 */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { MiniOpenClawConfig } from "../config.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("session");

export interface SessionHandle {
  /** 逻辑会话键，例如 "main:cli:default" */
  key: string;
  /** 磁盘文件绝对路径 */
  file: string;
  /** SessionManager 的 sessionId */
  id: string;
  /** 是否本次新建 */
  isNew: boolean;
  manager: SessionManager;
}

/** SessionManager 实例缓存（对应 OpenClaw 的 session-manager-cache） */
const managerCache = new Map<string, SessionManager>();

/** 把会话键转成安全文件名片段 */
function slugify(key: string): string {
  return key.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

/** 为某个 base key 找下一个可用的文件序号，避免覆盖历史会话 */
function nextSessionFile(cfg: MiniOpenClawConfig, baseKey: string): string {
  mkdirSync(cfg.sessionDir, { recursive: true });
  const slug = slugify(baseKey) || "session";
  const prefix = `${slug}__`;
  let maxIndex = 0;
  try {
    for (const name of readdirSync(cfg.sessionDir)) {
      if (!name.startsWith(prefix) || !name.endsWith(".jsonl")) continue;
      const n = Number.parseInt(name.slice(prefix.length, -".jsonl".length), 10);
      if (Number.isFinite(n) && n > maxIndex) maxIndex = n;
    }
  } catch {
    /* 目录不存在则忽略 */
  }
  return join(cfg.sessionDir, `${prefix}${maxIndex + 1}.jsonl`);
}

/** 找到已存在的最近一个会话文件（用于续聊） */
function latestSessionFile(cfg: MiniOpenClawConfig, baseKey: string): string | undefined {
  try {
    const slug = slugify(baseKey) || "session";
    const prefix = `${slug}__`;
    const candidates = readdirSync(cfg.sessionDir)
      .filter((n) => n.startsWith(prefix) && n.endsWith(".jsonl"))
      .map((n) => join(cfg.sessionDir, n))
      .filter((p) => {
        try {
          return statSync(p).size > 0;
        } catch {
          return false;
        }
      });
    if (candidates.length === 0) return undefined;
    // 按文件名里的序号做**数值**排序（避免 __10 排在 __2 前面）
    candidates.sort((a, b) => sessionFileIndex(a) - sessionFileIndex(b));
    return candidates[candidates.length - 1];
  } catch {
    return undefined;
  }
}

/**
 * 打开（或创建）一个会话。
 * @param forceNew true 时强制开新文件（实现 /new）
 */
export function openSession(cfg: MiniOpenClawConfig, sessionKey: string, forceNew = false): SessionHandle {
  const baseKey = sessionKey;

  if (!forceNew) {
    const cached = managerCache.get(baseKey);
    if (cached) {
      return {
        key: baseKey,
        file: cached.getSessionFile()!,
        id: cached.getSessionId(),
        isNew: false,
        manager: cached,
      };
    }
  }

  const existing = forceNew ? undefined : latestSessionFile(cfg, baseKey);
  const file = existing ?? nextSessionFile(cfg, baseKey);
  const isNew = !existing || forceNew;

  log.debug(`打开会话 key=${baseKey} file=${file} ${isNew ? "(新建)" : "(续聊)"}`);

  mkdirSync(cfg.sessionDir, { recursive: true });
  // 注意：**不要**预创建空文件。pi 的 SessionManager 对"已存在但无 header"的文件会
  // 立即写一次 header 并标记 flushed，随后首条 assistant 消息又会把所有 entry 重写一遍，
  // 导致 JSONL 里出现重复 header。让它自己决定何时落盘即可。
  const manager = SessionManager.open(file, cfg.sessionDir, cfg.workspaceDir);
  if (!forceNew) managerCache.set(baseKey, manager);

  return {
    key: baseKey,
    file: manager.getSessionFile() ?? file,
    id: manager.getSessionId(),
    isNew,
    manager,
  };
}

/** 开一个新会话（/new）：新文件 + 新 sessionId */
export function newSession(cfg: MiniOpenClawConfig, sessionKey: string): SessionHandle {
  managerCache.delete(sessionKey);
  const handle = openSession(cfg, sessionKey, true);
  managerCache.set(sessionKey, handle.manager);
  log.info(`已为 ${sessionKey} 开启新会话：${handle.file}`);
  return handle;
}

/** 会话文件是否已有内容 */
export function sessionHasContent(file: string): boolean {
  try {
    return existsSync(file) && statSync(file).size > 0;
  } catch {
    return false;
  }
}

/** 列出该会话键下的所有历史会话文件（按序号数值排序） */
export function listSessionFiles(cfg: MiniOpenClawConfig, sessionKey: string): string[] {
  try {
    const slug = slugify(sessionKey) || "session";
    const prefix = `${slug}__`;
    return readdirSync(cfg.sessionDir)
      .filter((n) => n.startsWith(prefix) && n.endsWith(".jsonl"))
      .map((n) => join(cfg.sessionDir, n))
      .sort((a, b) => sessionFileIndex(a) - sessionFileIndex(b));
  } catch {
    return [];
  }
}

function sessionFileIndex(path: string): number {
  const v = Number.parseInt(path.split("__").pop()?.replace(/\.jsonl$/, "") ?? "", 10);
  return Number.isFinite(v) ? v : 0;
}

/** 调试用：当前缓存了哪些会话键 */
export function debugCacheKeys(): string[] {
  return [...managerCache.keys()];
}
