/**
 * Mini-OpenClaw 用户配置（可选）。
 *
 * 存在时会被 src/config.ts 的 loadConfig() 自动加载并覆盖默认值。
 * 不存在时全部走默认配置 —— 开箱即用。
 *
 * 优先级：环境变量 > 本文件 > 内置默认值
 */
import type { MiniOpenClawConfig } from "./src/config.js";

const config: Partial<MiniOpenClawConfig> = {
  // 模型：默认是本地 Mock（无需 API Key）。
  // 换成真实模型只需：
  //   model: { mode: "real", provider: "anthropic", modelId: "claude-sonnet-4-5", thinkingLevel: "medium" }
  // 然后 export ANTHROPIC_API_KEY=...
  model: {
    mode: "mock",
    provider: "faux",
    modelId: "mock-1",
    thinkingLevel: "off",
    // 想接本地 vLLM / Ollama / LM Studio，打开下面这行：
    // baseUrl: "http://localhost:11434/v1",
  },

  // 暴露给 Agent 的内置工具（读安全、写危险，按需开启）
  builtInTools: ["read", "ls", "bash", "grep", "find"],

  /** 是否注入业务工具（get_product / list_products / select_scenario / save_copy） */
  enableCustomTools: true,

  // 追加到 system prompt 的指令
  extraInstructions: [
    "Keep replies concise and operator-friendly; deliver the copy first, commentary after.",
    "商品事实只来自 get_product 的结果;不确定的信息如实说明,不要编造。",
  ],
};

export default config;
