/**
 * 场景识别回归（需真实模型）：
 *   MINI_OPENCLAW_MODEL_MODE=real MINI_OPENCLAW_MODEL_PROVIDER=<provider> \
 *   MINI_OPENCLAW_MODEL_ID=<model> npm run eval:scenario
 * 逐条把 scenario-eval.jsonl 的运营说法喂给 Agent，比对 select_scenario 的选择。
 * 状态目录用临时目录；每条之间 /new 开新会话。
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelLayer } from "../src/agents/model.js";
import { RecordingChannel } from "../src/channels/recording.js";
import { loadConfig } from "../src/config.js";
import { Gateway } from "../src/gateway/gateway.js";

interface EvalItem {
  text: string;
  expected: string;
}

async function main(): Promise<void> {
  const cfg = await loadConfig();
  if (cfg.model.mode !== "real") {
    console.error("本脚本只跑真实模型。请设置 MINI_OPENCLAW_MODEL_MODE=real 及 provider/model 环境变量。");
    process.exit(1);
  }

  const tmp = mkdtempSync(join(tmpdir(), "scenario-eval-"));
  cfg.stateDir = join(tmp, "state");
  cfg.agentDir = join(cfg.stateDir, "agent");
  cfg.sessionDir = join(cfg.stateDir, "sessions");
  cfg.copiesDir = join(cfg.stateDir, "copies");

  const modelLayer = await createModelLayer(cfg);
  const gateway = new Gateway({ cfg, modelLayer, modelLabel: `${cfg.model.provider}/${cfg.model.modelId}` });
  const channel = new RecordingChannel({ conversationId: "eval" });
  gateway.registerChannel(channel);
  await gateway.start();

  const lines = readFileSync(join(process.cwd(), "test", "scenario-eval.jsonl"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EvalItem);

  if (lines.length === 0) {
    console.error("回归集为空:test/scenario-eval.jsonl 没有任何条目。");
    await gateway.stop();
    rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
  }

  let exitCode = 1;
  try {
    let pass = 0;
    let failed = 0;
    const misses: Array<{ text: string; expected: string; got: string }> = [];
    for (const item of lines) {
      await channel.inject("/new");
      const before = gateway.scenarioSelections.length;
      const failsBefore = gateway.stats.runsFailed;
      channel.clear();
      await channel.inject(item.text);
      if (gateway.stats.runsFailed > failsBefore) {
        // 运行失败(网络/API key 等)≠ 模型选错场景,单独计数,不计入准确率
        failed++;
        console.log(`! ${item.text} → 运行失败(不计入准确率,请检查网络/API 配置)`);
        continue;
      }
      // 一轮可能多次 select_scenario(如模型自我修正),以最后一次为准
      const got = gateway.scenarioSelections.slice(before).at(-1)?.scenarioId ?? "(未选择场景)";
      if (got === item.expected) pass++;
      else misses.push({ text: item.text, expected: item.expected, got });
      console.log(`${got === item.expected ? "✓" : "✗"} ${item.text} → ${got}${got === item.expected ? "" : `(期望 ${item.expected})`}`);
    }

    console.log(`\n准确率:${pass}/${lines.length - failed}`);
    if (failed > 0) console.log(`运行失败:${failed} 条`);
    if (misses.length > 0) {
      console.log("未命中清单:");
      for (const m of misses) console.log(`  · ${m.text}:got=${m.got} expected=${m.expected}`);
    }
    exitCode = misses.length > 0 || failed > 0 ? 1 : 0;
  } finally {
    await gateway.stop();
    rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("回归失败:", err);
  process.exit(1);
});
