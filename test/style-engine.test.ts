import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadStyleEngine } from "../src/agents/style-engine.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "styles.yaml");

test("加载成功并生成场景枚举(保持 yaml 顺序)", () => {
  const engine = loadStyleEngine(FIXTURE);
  assert.deepEqual(engine.scenarioIds, ["everyday", "month_end_promo", "regular_discount"]);
});

test("取品类卡:命中与缺失", () => {
  const engine = loadStyleEngine(FIXTURE);
  const card = engine.getCategoryCard("母婴-纸尿裤");
  assert.ok(card);
  assert.equal(card!.tone, "温柔安心、像有经验的妈妈在分享");
  assert.deepEqual(card!.vocabulary?.avoid, ["最", "第一", "100%"]);
  assert.equal(engine.getCategoryCard("不存在品类"), undefined);
  assert.deepEqual(engine.listCategoryCards(), ["通用", "母婴-纸尿裤"]);
});

test("取场景卡与场景表", () => {
  const engine = loadStyleEngine(FIXTURE);
  const card = engine.getScenarioCard("month_end_promo");
  assert.ok(card);
  assert.equal(card!.name, "月底冲量");
  assert.ok(card!.example);
  const table = engine.listScenarios();
  assert.deepEqual(table[1], { id: "month_end_promo", name: "月底冲量", hints: ["月底", "冲量"] });
});

test("文件不存在时抛出可读错误(fail-fast)", () => {
  assert.throws(() => loadStyleEngine(join(import.meta.dirname, "fixtures", "nope.yaml")), /不存在/);
});

test("场景 id 不合法时抛错", () => {
  const bad = join(import.meta.dirname, "fixtures", "styles-bad-id.yaml");
  assert.throws(() => loadStyleEngine(bad), /场景 id 不合法/);
});

test("场景卡为空(null)时抛错而非 TypeError", () => {
  const bad = join(import.meta.dirname, "fixtures", "styles-empty-card.yaml");
  assert.throws(() => loadStyleEngine(bad), /不是映射/);
});

test("未定义任何 scenarios 时抛错", () => {
  const bad = join(import.meta.dirname, "fixtures", "styles-empty-scenarios.yaml");
  assert.throws(() => loadStyleEngine(bad), /未定义任何 scenarios/);
});

test("缺少 everyday 默认场景时抛错", () => {
  const bad = join(import.meta.dirname, "fixtures", "styles-no-everyday.yaml");
  assert.throws(() => loadStyleEngine(bad), /缺少 everyday 场景/);
});
