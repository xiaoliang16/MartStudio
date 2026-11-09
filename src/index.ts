/**
 * 入口。对应真实 OpenClaw 的启动流程：
 *   配置 → 模型层（mock/real）→ Gateway → 注册渠道 → 启动
 *
 *   pnpm dev            # 交互式对话
 *   pnpm dev "列出文件"  # 一次性提问
 */
import { CliChannel } from "./channels/cli.js";
import { createMockModel } from "./agents/mock-model.js";
import { createModelLayer } from "./agents/model.js";
import { Gateway } from "./gateway/gateway.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const oneShot = process.argv[2];
  const cfg = await loadConfig();

  // mock 模式：注册 faux provider + 智能 responder；real 模式无需 mock
  const mock = cfg.model.mode === "mock" ? createMockModel() : undefined;
  mock?.enableSmartResponder();

  const modelLayer = await createModelLayer(cfg, mock);
  const modelLabel =
    cfg.model.mode === "mock"
      ? `faux/${modelLayer.model.id}（本地 Mock）`
      : `${cfg.model.provider}/${cfg.model.modelId}`;

  const gateway = new Gateway({ cfg, modelLayer, modelLabel });
  gateway.registerChannel(new CliChannel({ oneShotPrompt: oneShot }));

  await gateway.start();
}

main().catch((err) => {
  console.error("启动失败：", err);
  process.exit(1);
});
