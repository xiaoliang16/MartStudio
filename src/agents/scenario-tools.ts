/**
 * 场景工具:select_scenario(封闭枚举)。
 *
 * 场景由模型在 10 个运营定义的场景里选(受限识别,参照阿里妈妈的
 * "意图识别独立 Agent + 运营定义场景体系"),enum 从 styles.yaml 动态生成,
 * 模型选不到列表外的值;每次选择带 rationale,由 Gateway 记日志,可审计可回归。
 */
import { Type } from "typebox";
import type { CustomTool } from "./tools.js";
import type { StyleEngine } from "./style-engine.js";

export function createScenarioTool(
  styles: StyleEngine,
  onSelected: (scenarioId: string, rationale: string) => void,
): CustomTool[] {
  // enum 由数据文件生成:场景体系改 styles.yaml 即可,代码与数据不会脱节
  const scenarioIdSchema = Type.Union(styles.scenarioIds.map((id) => Type.Literal(id)));
  return [
    {
      name: "select_scenario",
      description: "从封闭场景枚举中选定本次文案的销售场景。每次文案任务都必须先调用本工具。",
      parameters: Type.Object({
        scenario_id: scenarioIdSchema,
        rationale: Type.String({ minLength: 1, description: "一句话说明为什么选这个场景(引用用户原话/上下文/日期)" }),
      }),
      async execute(args) {
        const id = String(args.scenario_id ?? "");
        const card = styles.getScenarioCard(id);
        if (!card) {
          return `❌ 未知场景:${id}。合法场景只有:${styles.scenarioIds.join("、")}`;
        }
        onSelected(id, String(args.rationale ?? ""));
        const parts = [
          `已选定场景:${card.name}(${id})`,
          `策略要点:\n${card.rules.map((r) => `- ${r}`).join("\n")}`,
        ];
        if (card.example) parts.push(`参考范文:\n${card.example.trim()}`);
        return parts.join("\n\n");
      },
    },
  ];
}
