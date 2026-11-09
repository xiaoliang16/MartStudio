/**
 * 风格引擎。加载 data/styles.yaml,提供品类风格卡与场景策略卡的查询。
 *
 * 两类卡:
 *   categories.<品类>  —— 品类风格卡(tone/structure/vocabulary/example)
 *   scenarios.<id>     —— 场景策略卡(name/hints/rules/example),key 集合即
 *                         select_scenario 工具的封闭枚举
 *
 * 加载即校验(fail-fast):文件缺失、YAML 解析失败、卡结构不全、场景 id 不合法,
 * 全部直接抛错——数据文件由运营维护,坏数据必须在启动时暴露,不能带到运行期。
 */
import { readFileSync } from "node:fs";
import { parse } from "yaml";

export interface CategoryStyleCard {
  tone: string;
  structure: string[];
  vocabulary?: { use: string[]; avoid: string[] };
  example?: string;
}

export interface ScenarioCard {
  name: string;
  hints: string[];
  rules: string[];
  example?: string;
}

interface StyleFile {
  categories?: Record<string, CategoryStyleCard>;
  scenarios?: Record<string, ScenarioCard>;
}

export interface StyleEngine {
  /** 场景封闭枚举(= styles.yaml 的 scenarios key,保持声明顺序) */
  readonly scenarioIds: readonly string[];
  getCategoryCard(category: string): CategoryStyleCard | undefined;
  listCategoryCards(): string[];
  getScenarioCard(id: string): ScenarioCard | undefined;
  /** 供 system prompt 的场景表使用 */
  listScenarios(): Array<{ id: string; name: string; hints: string[] }>;
}

export function loadStyleEngine(stylesPath: string): StyleEngine {
  let raw: string;
  try {
    raw = readFileSync(stylesPath, "utf8");
  } catch {
    throw new Error(`风格配置文件不存在或不可读:${stylesPath}`);
  }
  let parsed: StyleFile;
  try {
    parsed = parse(raw) as StyleFile;
  } catch (err) {
    throw new Error(`${stylesPath} 解析失败:${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error("styles.yaml 内容为空或不是映射");

  const categories = parsed.categories ?? {};
  const scenarios = parsed.scenarios ?? {};
  const ids = Object.keys(scenarios);
  if (ids.length === 0) throw new Error("styles.yaml 未定义任何 scenarios(至少 1 个)");
  for (const id of ids) {
    if (!/^[a-z][a-z0-9_]*$/.test(id)) {
      throw new Error(`场景 id 不合法:${id}(仅允许小写字母开头,含小写字母/数字/下划线)`);
    }
    const card = scenarios[id];
    if (!card || typeof card !== "object") throw new Error(`场景卡 ${id} 不是映射`);
    if (!card.name || !Array.isArray(card.hints) || !Array.isArray(card.rules)) {
      throw new Error(`场景卡 ${id} 缺少 name/hints/rules`);
    }
    if (!card.hints.every((h) => typeof h === "string") || !card.rules.every((r) => typeof r === "string")) {
      throw new Error(`场景卡 ${id} 的 hints/rules 必须是字符串数组`);
    }
  }
  if (!ids.includes("everyday")) {
    throw new Error("styles.yaml 缺少 everyday 场景(system prompt 默认场景,必须存在)");
  }
  for (const [name, card] of Object.entries(categories)) {
    if (!card || typeof card !== "object") throw new Error(`品类卡 ${name} 不是映射`);
    if (!card.tone || !Array.isArray(card.structure)) {
      throw new Error(`品类卡 ${name} 缺少 tone/structure`);
    }
    if (!card.structure.every((s) => typeof s === "string")) {
      throw new Error(`品类卡 ${name} 的 structure 必须是字符串数组`);
    }
  }

  return {
    scenarioIds: ids,
    getCategoryCard: (category) => categories[category],
    listCategoryCards: () => Object.keys(categories),
    getScenarioCard: (id) => scenarios[id],
    listScenarios: () => ids.map((id) => ({ id, name: scenarios[id].name, hints: scenarios[id].hints })),
  };
}
