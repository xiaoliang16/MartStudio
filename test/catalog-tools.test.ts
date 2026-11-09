import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadStyleEngine } from "../src/agents/style-engine.js";
import { loadCatalog } from "../src/agents/catalog.js";
import { createCatalogTools } from "../src/agents/catalog-tools.js";

const DIR = join(import.meta.dirname, "fixtures");
const tools = createCatalogTools(loadCatalog(join(DIR, "products.json")), loadStyleEngine(join(DIR, "styles.yaml")));
const getProduct = tools.find((t) => t.name === "get_product")!;
const listProducts = tools.find((t) => t.name === "list_products")!;

test("get_product:命中且品类有卡 → 商品全参数 + 风格卡", async () => {
  const out = await getProduct.execute({ sku: "SKU-1001" });
  assert.ok(out.includes("SKU-1001"));
  assert.ok(out.includes("瞬时吸收不反渗"));
  assert.ok(out.includes("89.9"));
  assert.ok(out.includes("母婴-纸尿裤"));
  assert.ok(out.includes("温柔安心"));
});

test("get_product:品类无卡 → 显式上报 + 现有卡清单,禁止回落", async () => {
  const out = await getProduct.execute({ sku: "SKU-9001" });
  assert.ok(out.includes("未配置风格卡"));
  assert.ok(out.includes("美妆-口红"));
  assert.ok(out.includes("通用"));
  assert.ok(out.includes("母婴-纸尿裤"));
  assert.ok(!out.includes("品类风格卡:美妆-口红"));
});

test("get_product:SKU 不存在 → 明确报错 + 相近候选仅列出供人确认", async () => {
  const out = await getProduct.execute({ sku: "SKU-100" });
  assert.ok(out.includes("不存在"));
  assert.ok(out.includes("SKU-1001")); // 相近候选被列出
  const none = await getProduct.execute({ sku: "ZZZ" });
  assert.ok(none.includes("不存在"));
  assert.ok(none.includes("没有相近候选"));
});

test("get_product:价格缺失 → 如实标注目录未提供,不编造价格", async () => {
  const out = await getProduct.execute({ sku: "SKU-3002" });
  assert.ok(out.includes("SKU-3002"));
  assert.ok(out.includes("雪松无火香薰补充装"));
  assert.ok(out.includes("目录未提供"));
  assert.ok(!out.includes("售价:¥")); // 不显示编造的价格
  assert.ok(!out.includes("原价"));
});

test("list_products:全量与关键字", async () => {
  const all = await listProducts.execute({});
  assert.ok(all.includes("SKU-1001") && all.includes("SKU-9001"));
  const hit = await listProducts.execute({ keyword: "口红" });
  assert.ok(hit.includes("SKU-9001") && !hit.includes("SKU-1001"));
});
