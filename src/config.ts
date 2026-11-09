/**
 * 配置加载。对应真实 OpenClaw 的 config 层。
 *
 * 优先级：环境变量 > mini-openclaw.config.ts（可选）> 内置默认值
 *
 * 环境变量：
 *   MINI_OPENCLAW_STATE_DIR    状态目录（默认 <cwd>/.mini-openclaw）
 *   MINI_OPENCLAW_MODEL_MODE   mock | real
 *   MINI_OPENCLAW_MODEL_PROVIDER / MINI_OPENCLAW_MODEL_ID   真实模型的 provider 与模型 id
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export interface ModelConfig {
  /** mock=进程内 faux provider（无需 API Key）；real=真实 provider */
  mode: "mock" | "real";
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  /** OpenAI 兼容端点（本地 vLLM / Ollama / LM Studio） */
  baseUrl?: string;
}

export interface MiniOpenClawConfig {
  /** Agent 的工作目录（工具在此目录下执行） */
  workspaceDir: string;
  /** pi 的全局配置目录（auth.json / models.json 落在这里） */
  agentDir: string;
  /** 状态目录（会话文件等） */
  stateDir: string;
  /** JSONL 会话文件目录 */
  sessionDir: string;
  /** 业务数据目录（products.json / styles.yaml） */
  dataDir: string;
  /** 文案存档目录 */
  copiesDir: string;

  model: ModelConfig;

  /** 暴露给 Agent 的内置工具白名单 */
  builtInTools: string[];
  /** 是否注入业务工具（get_product / list_products / select_scenario / save_copy） */
  enableCustomTools: boolean;
  /** 追加到 system prompt 的指令 */
  extraInstructions: string[];
}

export function defaultConfig(cwd: string = process.cwd()): MiniOpenClawConfig {
  const stateDir = join(cwd, ".mini-openclaw");
  return {
    workspaceDir: cwd,
    agentDir: join(stateDir, "agent"),
    stateDir,
    sessionDir: join(stateDir, "sessions"),
    dataDir: join(cwd, "data"),
    copiesDir: join(stateDir, "copies"),
    model: {
      mode: "mock",
      provider: "faux",
      modelId: "mock-1",
      thinkingLevel: "off",
    },
    builtInTools: ["read", "ls", "bash", "grep", "find"],
    enableCustomTools: true,
    extraInstructions: [],
  };
}

/** 加载配置：默认值 → mini-openclaw.config.ts → 环境变量 */
export async function loadConfig(cwd: string = process.cwd()): Promise<MiniOpenClawConfig> {
  const cfg = defaultConfig(cwd);

  const configFile = join(cwd, "mini-openclaw.config.ts");
  if (existsSync(configFile)) {
    const mod = (await import(pathToFileURL(configFile).href)) as {
      default?: Partial<MiniOpenClawConfig>;
    };
    const file = mod.default ?? {};
    cfg.model = { ...cfg.model, ...(file.model ?? {}) };
    if (file.builtInTools) cfg.builtInTools = file.builtInTools;
    if (file.enableCustomTools !== undefined) cfg.enableCustomTools = file.enableCustomTools;
    if (file.extraInstructions) cfg.extraInstructions = file.extraInstructions;
    if (file.workspaceDir) cfg.workspaceDir = file.workspaceDir;
    if (file.stateDir) cfg.stateDir = file.stateDir;
    if (file.dataDir) cfg.dataDir = file.dataDir;
  }

  // ---- 环境变量覆盖 ----
  const envStateDir = process.env.MINI_OPENCLAW_STATE_DIR;
  if (envStateDir) cfg.stateDir = envStateDir;
  cfg.agentDir = join(cfg.stateDir, "agent");
  cfg.sessionDir = join(cfg.stateDir, "sessions");
  cfg.copiesDir = join(cfg.stateDir, "copies");

  const envMode = process.env.MINI_OPENCLAW_MODEL_MODE;
  if (envMode === "mock" || envMode === "real") cfg.model.mode = envMode;
  if (process.env.MINI_OPENCLAW_MODEL_PROVIDER) cfg.model.provider = process.env.MINI_OPENCLAW_MODEL_PROVIDER;
  if (process.env.MINI_OPENCLAW_MODEL_ID) cfg.model.modelId = process.env.MINI_OPENCLAW_MODEL_ID;

  return cfg;
}
