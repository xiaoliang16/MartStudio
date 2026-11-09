/**
 * 文案工具:save_copy(产出契约)。
 *
 * 产出契约 = 本工具的参数 schema:模型要存档就必须按"标题+正文+卖点数组"
 * 结构产出,避免"输出 JSON 再解析"的脆弱方案。多版本 = 每篇调用一次,
 * 文件名序号自增:YYYYMMDD-SKU-场景__N.json
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import type { CustomTool } from "./tools.js";

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** 同一"日期+SKU+场景"前缀下的下一个序号,避免覆盖历史文案 */
function nextIndex(dir: string, prefix: string): number {
  let max = 0;
  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(`${prefix}__`) || !name.endsWith(".json")) continue;
      const n = Number.parseInt(name.slice(prefix.length + 2, -".json".length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  } catch {
    /* 目录不存在则从 1 开始 */
  }
  return max + 1;
}

export function createCopyTool(copiesDir: string): CustomTool[] {
  return [
    {
      name: "save_copy",
      description: "保存一篇结构化文案(标题+正文+卖点)到文案库。每篇调用一次;多版本就多次调用。",
      parameters: Type.Object({
        sku: Type.String({ description: "商品 SKU" }),
        scenario_id: Type.String({ description: "本次选定的场景 id(select_scenario 的结果)" }),
        title: Type.String({ description: "文案标题" }),
        body: Type.String({ description: "文案正文" }),
        bullets: Type.Array(Type.String(), { description: "卖点列表,每条一项" }),
      }),
      async execute(args) {
        const sku = String(args.sku ?? "");
        const scenarioId = String(args.scenario_id ?? "");
        const title = String(args.title ?? "");
        const body = String(args.body ?? "");
        if (!title.trim() || !body.trim()) {
          return `❌ 保存失败:标题与正文不能为空,请补全后再存档。`;
        }
        try {
          mkdirSync(copiesDir, { recursive: true });
          const prefix = `${today()}-${sanitize(sku)}-${sanitize(scenarioId)}`;
          const n = nextIndex(copiesDir, prefix);
          const file = join(copiesDir, `${prefix}__${n}.json`);
          const record = {
            sku,
            scenarioId,
            title,
            body,
            bullets: Array.isArray(args.bullets) ? args.bullets.map(String) : [],
            savedAt: new Date().toISOString(),
          };
          writeFileSync(file, JSON.stringify(record, null, 2), "utf8");
          return `✅ 已保存文案:${file}`;
        } catch (err) {
          return `❌ 保存失败:${err instanceof Error ? err.message : String(err)}(文案在对话中仍可见,请告知运营手工留存)`;
        }
      },
    },
  ];
}
