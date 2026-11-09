/**
 * 电商文案 Agent 演示（零 API key，Mock 模型）：
 *
 *   npm run demo:copy
 *
 * 跑两条链路：
 *   1. 正常产出：月底促销 → 查商品 → 选场景 → 存文案
 *   2. 显式上报：无风格卡商品 → 先暂停动笔，等人工确认
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockModel } from "../src/agents/mock-model.js";
import { createModelLayer } from "../src/agents/model.js";
import { RecordingChannel } from "../src/channels/recording.js";
import { defaultConfig } from "../src/config.js";
import { Gateway } from "../src/gateway/gateway.js";

const C = {
  reset: "\u001b[0m", bold: "\u001b[1m", dim: "\u001b[2m",
  cyan: "\u001b[36m", green: "\u001b[32m", yellow: "\u001b[33m", magenta: "\u001b[35m",
};

function heading(title: string): void {
  console.log(`\n${C.bold}${C.magenta}━━━ ${title} ${"━".repeat(Math.max(0, 52 - title.length))}${C.reset}\n`);
}

async function main(): Promise<void> {
  const cfg = defaultConfig(process.cwd());
  const tmp = mkdtempSync(join(tmpdir(), "copy-demo-"));
  cfg.stateDir = join(tmp, "state");
  cfg.agentDir = join(cfg.stateDir, "agent");
  cfg.sessionDir = join(cfg.stateDir, "sessions");
  cfg.copiesDir = join(cfg.stateDir, "copies");

  const mock = createMockModel({ tokensPerSecond: 0 });
  mock.enableSmartResponder();
  const modelLayer = await createModelLayer(cfg, mock);
  const gateway = new Gateway({ cfg, modelLayer, modelLabel: "faux/mock-1(本地 Mock)" });
  const channel = new RecordingChannel({ conversationId: "copy-demo" });
  gateway.registerChannel(channel);
  await gateway.start();

  console.log(`${C.bold}🦞 电商文案 Agent 演示（Mock 模型，零 API key）${C.reset}`);
  console.log(`${C.dim}数据目录：${cfg.dataDir} | 文案库：${cfg.copiesDir}${C.reset}`);
  try {
    heading("链路 1：月底促销文案（正常产出）");
    console.log(`${C.cyan}👤 运营：给 SKU-1001 写一篇月底促销文案${C.reset}\n`);
    channel.clear();
    await channel.inject("给 SKU-1001 写一篇月底促销文案");
    for (const s of channel.statuses()) console.log(`   ${C.yellow}${s}${C.reset}`);
    console.log(`\n${C.green}🦞 Agent:${C.reset}`);
    console.log(channel.blocks().join("\n").split("\n").map((l) => `   ${l}`).join("\n"));

    const files = readdirSync(cfg.copiesDir);
    console.log(`\n${C.dim}文案库（${files.length} 篇）：${C.reset}`);
    for (const f of files) {
      const record = JSON.parse(readFileSync(join(cfg.copiesDir, f), "utf8"));
      console.log(`   · ${f}`);
      console.log(`     ${C.dim}sku=${record.sku} scenario=${record.scenarioId} title=${record.title}${C.reset}`);
    }
    console.log(`\n${C.dim}场景审计：${JSON.stringify(gateway.scenarioSelections)}${C.reset}`);

    heading("链路 2：无风格卡商品（显式上报，人工确认）");
    console.log(`${C.cyan}👤 运营：给 SKU-9001 写一篇日常文案${C.reset}\n`);
    channel.clear();
    await channel.inject("给 SKU-9001 写一篇日常文案");
    for (const s of channel.statuses()) console.log(`   ${C.yellow}${s}${C.reset}`);
    console.log(`\n${C.green}🦞 Agent:${C.reset}`);
    console.log(channel.blocks().join("\n").split("\n").map((l) => `   ${l}`).join("\n"));
    console.log(`\n${C.dim}文案库仍为 ${readdirSync(cfg.copiesDir).length} 篇——未确认前不产出。${C.reset}`);
  } finally {
    await gateway.stop();
    /* Windows %TEMP% 不会自动清理,演示结束即删 */
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${C.green}✅ 演示完成${C.reset}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("演示失败:", err);
  process.exit(1);
});
