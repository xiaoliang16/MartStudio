import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Value } from "typebox/value";
import { loadStyleEngine } from "../src/agents/style-engine.js";
import { createScenarioTool } from "../src/agents/scenario-tools.js";

const styles = loadStyleEngine(join(import.meta.dirname, "fixtures", "styles.yaml"));
const selected: Array<{ id: string; why: string }> = [];
const tool = createScenarioTool(styles, (id, why) => selected.push({ id, why }))[0];

test("合法场景:返回策略卡全文并回调记录", async () => {
  const out = await tool.execute({ scenario_id: "month_end_promo", rationale: "用户说月底冲量" });
  assert.ok(out.includes("月底冲量"));
  assert.ok(out.includes("倒计时紧迫感"));
  assert.ok(out.includes("月底最后3天"));
  assert.deepEqual(selected, [{ id: "month_end_promo", why: "用户说月底冲量" }]);
});

test("非法场景:拒绝并列出合法枚举(schema enum 之外的第二道防线)", async () => {
  selected.length = 0;
  const out = await tool.execute({ scenario_id: "double11", rationale: "x" });
  assert.ok(out.includes("未知场景"));
  assert.ok(out.includes("month_end_promo"));
  assert.equal(selected.length, 0);
});

test("参数 schema 只接受 styles.yaml 里的场景(封闭枚举,行为断言)", () => {
  assert.equal(Value.Check(tool.parameters, { scenario_id: "month_end_promo", rationale: "x" }), true);
  assert.equal(Value.Check(tool.parameters, { scenario_id: "double11", rationale: "x" }), false);
});
