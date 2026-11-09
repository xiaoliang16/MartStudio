/**
 * 商品目录数据层。加载 data/products.json,提供精确与模糊查询。
 *
 * params 是自由 key-value(不同品类参数差异大,不写死 schema);
 * sellingPoints 单独成列,是运营提炼的一级卖点,文案必须体现;
 * price/originalPrice 双字段支撑打折场景的原价锚点。
 */
import { readFileSync } from "node:fs";

export interface Product {
  sku: string;
  name: string;
  category: string;
  brand?: string;
  price?: number;
  originalPrice?: number;
  params: Record<string, string>;
  sellingPoints: string[];
}

export interface Catalog {
  findBySku(sku: string): Product | undefined;
  /** 关键字模糊搜索:匹配 sku/名称/品类/品牌(大小写不敏感);空关键字返回全部 */
  search(keyword: string): Product[];
  all(): Product[];
}

interface ProductsFile {
  products: Product[];
}

export function loadCatalog(productsPath: string): Catalog {
  let parsed: ProductsFile;
  try {
    parsed = JSON.parse(readFileSync(productsPath, "utf8")) as ProductsFile;
  } catch (err) {
    throw new Error(
      `products.json 不存在或解析失败:${productsPath}(${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const list = parsed?.products;
  if (!Array.isArray(list) || list.length === 0) throw new Error("products.json 未包含任何商品");
  const seen = new Set<string>();
  for (const p of list) {
    if (!p || typeof p !== "object") throw new Error("商品条目不是对象");
    if (p.price !== undefined && typeof p.price !== "number") {
      throw new Error(`商品 ${p.sku} 的 price 必须是数字`);
    }
    if (p.originalPrice !== undefined && typeof p.originalPrice !== "number") {
      throw new Error(`商品 ${p.sku} 的 originalPrice 必须是数字`);
    }
    if (!p.sku || !p.name || !p.category) {
      throw new Error(`商品缺少 sku/name/category:${JSON.stringify(p).slice(0, 80)}`);
    }
    if (seen.has(p.sku)) throw new Error(`SKU 重复:${p.sku}`);
    seen.add(p.sku);
    p.params = p.params ?? {};
    p.sellingPoints = p.sellingPoints ?? [];
  }
  const bySku = new Map(list.map((p) => [p.sku, p]));
  return {
    findBySku: (sku) => bySku.get(sku),
    search: (keyword) => {
      const k = keyword.trim().toLowerCase();
      if (!k) return list;
      return list.filter((p) =>
        [p.sku, p.name, p.category, p.brand ?? ""].join(" ").toLowerCase().includes(k),
      );
    },
    all: () => list,
  };
}
