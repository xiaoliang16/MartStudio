/**
 * 零 key 端到端:运营输入 → Gateway → mock 模型剧本 →
 * get_product → select_scenario → 生成 → save_copy 落盘。
 * 数据用项目根的 data/(即真实随附数据),状态目录用临时目录。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockModel } from "../src/agents/mock-model.js";
import { createModelLayer } from "../src/agents/model.js";
import { RecordingChannel } from "../src/channels/recording.js";
import { defaultConfig } from "../src/config.js";
import { Gateway } from "../src/gateway/gateway.js";

test("e2e:月底促销文案全链路 + 无风格卡显式上报", async (t) => {
  const cfg = defaultConfig(process.cwd());
  const tmp = mkdtempSync(join(tmpdir(), "copy-e2e-"));
  cfg.stateDir = join(tmp, "state");
  cfg.agentDir = join(cfg.stateDir, "agent");
  cfg.sessionDir = join(cfg.stateDir, "sessions");
  cfg.copiesDir = join(cfg.stateDir, "copies");
  t.after(() => {
    /* Windows %TEMP% 不会自动清理,测试结束即删(写入全是同步,stop 后可安全删除) */
    rmSync(tmp, { recursive: true, force: true });
  });

  const mock = createMockModel({ tokensPerSecond: 0 });
  mock.enableSmartResponder();
  const modelLayer = await createModelLayer(cfg, mock);
  const gateway = new Gateway({ cfg, modelLayer, modelLabel: "faux/mock-1" });
  const channel = new RecordingChannel({ conversationId: "e2e" });
  gateway.registerChannel(channel);
  await gateway.start();

  // ---- 正常链路:月底促销 ----
  await channel.inject("给 SKU-1001 写一篇月底促销文案");
  const statuses = channel.statuses().join("\n");
  assert.ok(statuses.includes("get_product"), "应调用 get_product");
  assert.ok(statuses.includes("select_scenario"), "应调用 select_scenario");
  assert.ok(statuses.includes("save_copy"), "应调用 save_copy");
  assert.ok(channel.blocks().join("\n").includes("【Mock 演示】"), "对话中应展示成稿");

  const files = readdirSync(cfg.copiesDir);
  assert.equal(files.length, 1, "文案库应有 1 个文件");
  const record = JSON.parse(readFileSync(join(cfg.copiesDir, files[0]), "utf8"));
  assert.equal(record.sku, "SKU-1001");
  assert.equal(record.scenarioId, "month_end_promo");
  assert.ok(record.bullets.length >= 1);

  // 场景选择审计:id + rationale
  assert.equal(gateway.scenarioSelections.length, 1);
  assert.equal(gateway.scenarioSelections[0].scenarioId, "month_end_promo");
  assert.ok(gateway.scenarioSelections[0].rationale.length > 0);

  // ---- 显式上报链路:无风格卡商品,停下询问,不落盘 ----
  channel.clear();
  await channel.inject("给 SKU-9001 写一篇日常文案");
  const paused = channel.blocks().join("\n");
  assert.ok(paused.includes("先暂停动笔"), "应显式上报并暂停");
  assert.ok(paused.includes("未配置风格卡"), "应转述缺卡问题");
  assert.equal(readdirSync(cfg.copiesDir).length, 1, "未确认前不得产出文案");

  await gateway.stop();
});
