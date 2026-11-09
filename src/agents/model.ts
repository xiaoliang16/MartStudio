/**
 * 模型层装配。对应真实 OpenClaw 的 model.ts + model-auth.ts。
 *
 * 把「配置里的模型声明」变成 pi 需要的两件套：
 *   Model（用哪个模型）+ ModelRuntime（pi 1.x 的统一模型/凭据运行时）
 *
 * mock 模式用进程内 faux provider；real 模式走 pi-ai 的真实 provider。
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Model } from "@earendil-works/pi-ai";
import type { MiniOpenClawConfig } from "../config.js";
import type { MockModelHandle } from "./mock-model.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("model");

export interface ModelLayer {
  model: Model<any>;
  modelRuntime: ModelRuntime;
}

export async function createModelLayer(cfg: MiniOpenClawConfig, mock?: MockModelHandle): Promise<ModelLayer> {
  mkdirSync(cfg.agentDir, { recursive: true });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(cfg.agentDir, "auth.json"),
    modelsPath: join(cfg.agentDir, "models.json"),
    refreshOnCreate: false,
  });

  if (cfg.model.mode === "mock") {
    if (!mock) throw new Error("model.mode=mock 需要先 createMockModel() 并传入句柄");
    // pi 1.x 的 ModelRuntime 只认内置 provider 目录，而 faux 注册在 pi-ai 的全局
    // API 注册表里。这里用 registerProvider 给 faux 配一个带静态 key 的壳 provider：
    //   · 鉴权门（_getRequiredRequestAuth）由静态 apiKey 满足
    //   · 流分发最终落到 getApiProvider(model.api) —— 即 registerFauxProvider
    //     注册的进程内假实现
    modelRuntime.registerProvider(cfg.model.provider, { apiKey: "faux-mock-key" });
    log.info(`模型层（mock）：faux/${mock.getModel().id}`);
    return { model: mock.getModel(), modelRuntime };
  }

  // 真实模型。provider/modelId 来自运行时配置字符串，泛型只能断言成 never 再收回 Model<any>。
  const model = getBuiltinModel(cfg.model.provider as never, cfg.model.modelId as never) as Model<any>;
  if (cfg.model.baseUrl) {
    // pi-ai 的 baseUrl 由各 provider 的环境变量控制（如 OPENAI_BASE_URL），
    // 这里只提示，不在进程内篡改环境。
    log.warn(`已配置 model.baseUrl=${cfg.model.baseUrl}，请确保对应 provider 的环境变量指向同一端点`);
  }
  log.info(`模型层（real）：${cfg.model.provider}/${cfg.model.modelId}`);
  return { model, modelRuntime };
}
