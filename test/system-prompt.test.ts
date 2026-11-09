import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadStyleEngine } from "../src/agents/style-engine.js";
import { buildAgentSystemPrompt, buildDateContext } from "../src/agents/system-prompt.js";
import { defaultConfig } from "../src/config.js";

const styles = loadStyleEngine(join(import.meta.dirname, "fixtures", "styles.yaml"));

test("prompt 含文案师角色、场景表、硬规则与产出契约", () => {
  const prompt = buildAgentSystemPrompt({
    cfg: defaultConfig("D:/demo"),
    channelType: "demo",
    conversationId: "c1",
    sessionKey: "main:demo:c1",
    toolNames: ["select_scenario", "get_product", "save_copy"],
    modelLabel: "faux/mock-1",
    styles,
  });
  assert.ok(prompt.includes("电商文案"), "角色");
  assert.ok(prompt.includes("事实完整性") && prompt.includes("绝不编造"), "硬规则1");
  assert.ok(prompt.includes("显式上报"), "硬规则2");
  assert.ok(prompt.includes("必走流程") && prompt.includes("save_copy"), "硬规则3+契约");
  assert.ok(prompt.includes("month_end_promo") && prompt.includes("月底冲量"), "场景表");
  assert.ok(prompt.includes("默认 everyday"), "选择规则");
});

test("日期上下文:固定日期可算剩余天数(仅提示,非规则)", () => {
  const line = buildDateContext(new Date(2026, 10, 8)); // 2026-11-08,11 月共 30 天
  assert.ok(line.includes("2026-11-08"));
  assert.ok(line.includes("还剩 22 天"));
  assert.ok(line.includes("仅作场景识别的上下文提示"));
});

test("日期上下文:月末当天剩余天数为 0", () => {
  const line = buildDateContext(new Date(2026, 0, 31)); // 2026-01-31,1 月共 31 天
  assert.ok(line.includes("2026-01-31"));
  assert.ok(line.includes("还剩 0 天"));
});

test("extraInstructions 非空时渲染 Additional instructions 段落", () => {
  const prompt = buildAgentSystemPrompt({
    cfg: { ...defaultConfig("D:/demo"), extraInstructions: ["所有文案末尾附一句提问引导互动"] },
    channelType: "demo",
    conversationId: "c1",
    sessionKey: "main:demo:c1",
    toolNames: ["select_scenario"],
    modelLabel: "faux/mock-1",
    styles,
  });
  assert.ok(prompt.includes("## Additional instructions"));
  assert.ok(prompt.includes("所有文案末尾附一句提问引导互动"));
});
