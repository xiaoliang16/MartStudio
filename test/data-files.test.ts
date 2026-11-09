import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadStyleEngine } from "../src/agents/style-engine.js";
import { loadCatalog } from "../src/agents/catalog.js";

const DATA = join(import.meta.dirname, "..", "data");
const styles = loadStyleEngine(join(DATA, "styles.yaml"));

test("随附数据可加载，场景封闭枚举恰为 10 个", () => {
  assert.equal(styles.scenarioIds.length, 10);
  for (const id of ["everyday", "regular_discount", "month_end_promo", "mega_sale", "pre_sale", "new_launch", "clearance", "festival", "membership", "seeding"]) {
    assert.ok(styles.scenarioIds.includes(id), `缺少场景 ${id}`);
  }
});

test("每个商品品类都有风格卡，除演示显式上报的 SKU-9001/9002", () => {
  const catalog = loadCatalog(join(DATA, "products.json"));
  assert.equal(catalog.all().length, 17);
  const cardless = catalog.all().filter((p) => styles.getCategoryCard(p.category) === undefined);
  assert.deepEqual(cardless.map((p) => p.sku), ["SKU-9001", "SKU-9002"]);
});

test("hints 含非字符串（未加引号的数字）时抛错", () => {
  const fixture = join(import.meta.dirname, "fixtures", "styles-num-hint.yaml");
  assert.throws(() => loadStyleEngine(fixture), /字符串数组/);
});
