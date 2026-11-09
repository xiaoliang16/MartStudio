/**
 * 商品工具:get_product / list_products。
 *
 * get_product 是"事实唯一入口":返回商品全参数,并随品类附上风格卡
 * (风格知识走工具数据流,不静态塞 prompt)。三种结果:
 *   1. 命中且有卡 → 商品 + 品类风格卡
 *   2. 命中但无卡 → 商品 + 显式上报(附现有卡清单),禁止自动回落
 *   3. 未命中     → 报错 + 相近候选仅列出供人工确认,禁止自行替代
 */
import { Type } from "typebox";
import type { CustomTool } from "./tools.js";
import type { Catalog, Product } from "./catalog.js";
import type { CategoryStyleCard, StyleEngine } from "./style-engine.js";

/** 上报标识串:mock 剧本以此识别"需人工确认"的工具结果 */
export const NO_CARD_MARKER = "未配置风格卡";
export const NO_SKU_MARKER = "不存在 SKU";

function formatProduct(p: Product): string {
  const lines = [
    `## 商品 ${p.sku}`,
    `- 名称:${p.name}`,
    `- 品类:${p.category}`,
  ];
  if (p.brand) lines.push(`- 品牌:${p.brand}`);
  if (p.price !== undefined) {
    lines.push(`- 售价:¥${p.price}${p.originalPrice !== undefined ? `(原价 ¥${p.originalPrice})` : ""}`);
  } else {
    lines.push(`- 售价:目录未提供(如文案需要价格,请向运营确认,不得编造)`);
  }
  const params = Object.entries(p.params);
  if (params.length > 0) lines.push(`- 参数:${params.map(([k, v]) => `${k}=${v}`).join(";")}`);
  if (p.sellingPoints.length > 0) {
    lines.push(`- 一级卖点(必须体现):${p.sellingPoints.join("/")}`);
  }
  return lines.join("\n");
}

function formatCard(category: string, card: CategoryStyleCard): string {
  const lines = [`## 品类风格卡:${category}`, `- 语气基调:${card.tone}`, `- 结构:${card.structure.join(" → ")}`];
  if (card.vocabulary) {
    lines.push(`- 用词倾向:${card.vocabulary.use.join("/")}`);
    lines.push(`- 禁用词(硬约束,出现即违规):${card.vocabulary.avoid.join("/")}`);
  }
  if (card.example) lines.push(`- 参考范文:\n${card.example.trim()}`);
  return lines.join("\n");
}

export function createCatalogTools(catalog: Catalog, styles: StyleEngine): CustomTool[] {
  return [
    {
      name: "get_product",
      description: "按 SKU 查询商品详情(名称/价格/参数/卖点),并返回该品类的风格卡。写文案前必须调用。",
      parameters: Type.Object({
        sku: Type.String({ description: "商品 SKU,例如 SKU-1001" }),
      }),
      async execute(args) {
        const sku = String(args.sku ?? "").trim();
        const product = catalog.findBySku(sku);
        if (!product) {
          const candidates = catalog.search(sku).filter((p) => p.sku !== sku).slice(0, 5);
          const parts = [`❌ 目录中${NO_SKU_MARKER}「${sku}」,不能猜测替代,请与运营确认。`];
          if (candidates.length > 0) {
            parts.push(
              `相近候选(仅供参考,由运营确认后才能使用):\n${candidates
                .map((c) => `- ${c.sku} ${c.name}(${c.category})`)
                .join("\n")}`,
            );
          } else {
            parts.push("目录中没有相近候选。请运营确认 SKU 是否正确,或先补充 data/products.json。");
          }
          return parts.join("\n\n");
        }
        const card = styles.getCategoryCard(product.category);
        if (!card) {
          const cards = styles.listCategoryCards();
          return [
            formatProduct(product),
            `⚠️ 品类「${product.category}」${NO_CARD_MARKER},先不要动笔。请向运营确认:\n① 从现有品类卡中指定一张:${cards.map((n) => `「${n}」`).join("")}\n② 或先补充 data/styles.yaml 后重试。\n(规则:不会自动回落到任何默认卡;「通用」卡也仅在运营显式点名时可用)`,
          ].join("\n\n");
        }
        return [formatProduct(product), formatCard(product.category, card)].join("\n\n");
      },
    },
    {
      name: "list_products",
      description: "列出商品目录(可按关键字过滤 sku/名称/品类)。运营没给 SKU 时先用它找。",
      parameters: Type.Object({
        keyword: Type.Optional(Type.String({ description: "过滤关键字,可省略" })),
      }),
      async execute(args) {
        const keyword = String(args.keyword ?? "");
        const all = catalog.search(keyword);
        const list = all.slice(0, 20);
        if (list.length === 0) return `目录中没有匹配「${keyword}」的商品。`;
        const header = all.length > list.length ? `共 ${all.length} 个匹配,仅显示前 ${list.length} 个:` : `共 ${list.length} 个商品:`;
        return [header, ...list.map((p) => `- ${p.sku} | ${p.name} | ${p.category}${p.price !== undefined ? ` | ¥${p.price}` : ""}`)].join("\n");
      },
    },
  ];
}
