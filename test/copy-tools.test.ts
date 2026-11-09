import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCopyTool } from "../src/agents/copy-tools.js";

test("save_copy:结构化落盘,同前缀序号自增", async () => {
  const dir = mkdtempSync(join(tmpdir(), "copy-tool-"));
  const tool = createCopyTool(dir)[0];

  const args = {
    sku: "SKU-1001",
    scenario_id: "month_end_promo",
    title: "【月底最后3天】纸尿裤立减40",
    body: "正文……",
    bullets: ["卖点一", "卖点二"],
  };
  const out1 = await tool.execute(args);
  assert.ok(out1.includes("__1.json"));

  await tool.execute(args);
  const files = readdirSync(dir).sort();
  assert.equal(files.length, 2);
  assert.ok(files[0].endsWith("__1.json") && files[1].endsWith("__2.json"));
  // 用本地日期拼期望前缀(与 today() 一致,避免 UTC/本地日期不一致时误报)
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  assert.ok(files[0].startsWith(ymd));
  assert.ok(files[0].includes("SKU-1001") && files[0].includes("month_end_promo"));

  const record = JSON.parse(readFileSync(join(dir, files[0]), "utf8"));
  assert.equal(record.sku, "SKU-1001");
  assert.equal(record.scenarioId, "month_end_promo");
  assert.equal(record.title, args.title);
  assert.deepEqual(record.bullets, args.bullets);
  assert.ok(record.savedAt);
});

test("save_copy:标题或正文为空 → 拒绝落盘,目录保持为空", async () => {
  const dir = mkdtempSync(join(tmpdir(), "copy-tool-"));
  const tool = createCopyTool(dir)[0];
  const out = await tool.execute({ sku: "SKU-1001", scenario_id: "month_end_promo", title: "  ", body: "", bullets: [] });
  assert.ok(out.includes("保存失败"));
  assert.equal(readdirSync(dir).length, 0);
});
