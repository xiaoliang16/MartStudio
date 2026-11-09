import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadCatalog } from "../src/agents/catalog.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "products.json");

test("按 SKU 精确查找,查不到返回 undefined", () => {
  const catalog = loadCatalog(FIXTURE);
  assert.equal(catalog.findBySku("SKU-1001")!.name, "云柔亲肤婴儿纸尿裤 L码 44片");
  assert.equal(catalog.findBySku("SKU-404"), undefined);
});

test("关键字模糊搜索(命中 sku/名称/品类)", () => {
  const catalog = loadCatalog(FIXTURE);
  assert.equal(catalog.search("纸尿裤").length, 1);
  assert.equal(catalog.search("sku-9").length, 1);
  assert.equal(catalog.search("美妆").length, 1);
  assert.equal(catalog.search("不存在的关键字").length, 0);
  assert.equal(catalog.search("").length, 3);
});

test("缺字段的数据文件抛错(fail-fast)", () => {
  const bad = join(import.meta.dirname, "fixtures", "products-bad.json");
  assert.throws(() => loadCatalog(bad), /缺少 sku\/name\/category/);
});

test("price 为字符串时抛错(必须为数字)", () => {
  const bad = join(import.meta.dirname, "fixtures", "products-bad-price.json");
  assert.throws(() => loadCatalog(bad), /price 必须是数字/);
});

test("SKU 重复时抛错", () => {
  const bad = join(import.meta.dirname, "fixtures", "products-dup.json");
  assert.throws(() => loadCatalog(bad), /SKU 重复/);
});
