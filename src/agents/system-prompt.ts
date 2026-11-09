/**
 * 动态 System Prompt。文案师角色 + 硬规则 + 场景表 + 日期上下文 + 产出契约,
 * 经 DefaultResourceLoader 的 systemPromptOverride 完整替换 pi 默认 prompt。
 *
 * 场景表从 styles.yaml 动态生成(场景体系改数据文件即可,不改代码);
 * 日期仅作场景识别的上下文提示,不是规则——判断权在模型的 select_scenario。
 */
import type { MiniOpenClawConfig } from "../config.js";
import type { StyleEngine } from "./style-engine.js";

export interface BuildSystemPromptParams {
  cfg: MiniOpenClawConfig;
  channelType: string;
  conversationId: string;
  sessionKey: string;
  toolNames: string[];
  modelLabel: string;
  styles: StyleEngine;
}

/** 日期上下文(可注入固定日期便于测试):今天几号、本月还剩几天 */
export function buildDateContext(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const lastDay = new Date(y, m, 0).getDate();
  const remain = lastDay - d;
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `今天是 ${y}-${mm}-${dd}(周${weekdays[now.getDay()]}),${m} 月还剩 ${remain} 天。日期仅作场景识别的上下文提示,不是规则。`;
}

export function buildAgentSystemPrompt(p: BuildSystemPromptParams): string {
  // 清洗表格单元格:运营维护的名称/线索若含 | 或换行会破坏 markdown 表格
  const cell = (s: string) => s.replace(/[|\n]/g, " ");
  const scenarioTable = p.styles
    .listScenarios()
    .map((s) => `| ${cell(s.id)} | ${cell(s.name)} | ${s.hints.map(cell).join("、")} |`)
    .join("\n");

  const sections: string[] = [
    [
      "你是一名资深电商文案专家,服务对象是本公司运营人员,任务是按运营的指令撰写商品文案。",
      "用中文回复,直接给结果,少客套。",
    ].join("\n"),
    [
      "## 硬规则(违反任何一条即任务失败)",
      "1. 事实完整性:商品名、价格、参数、卖点等一切事实只能来自 get_product 返回的目录数据。目录里没有的信息,停下询问运营,绝不编造。",
      "2. 显式上报:工具结果出现「未配置风格卡」「不存在 SKU」「目录未提供」等提示时,立即停止动笔,把选项原样转述给运营,由人确认后再继续。禁止静默降级、禁止自行猜测替代。「通用」卡仅当运营显式点名时使用。",
      "3. 必走流程:动笔前必须先调用 select_scenario 和 get_product(顺序不限);成稿必须调用 save_copy 存档,多版本则每篇调用一次。",
      "4. 禁用词:品类风格卡 vocabulary.avoid 列出的词是硬约束(含广告法禁用词),文案中不得出现。",
    ].join("\n"),
    [
      "## 销售场景(封闭枚举)",
      "动笔前用 select_scenario 从下表选定场景,并给一句 rationale:",
      "",
      "| id | 场景 | 识别线索 |",
      "|---|---|---|",
      scenarioTable,
      "",
      "选择规则:用户明说 > 对话上下文 > 日期提示 > 默认 everyday。只能选表内 id,选不到别的值。",
    ].join("\n"),
    ["## 日期上下文", buildDateContext()].join("\n"),
    [
      "## 产出契约",
      "- 对话中用自然排版展示成稿:标题、正文、卖点列表。",
      "- 存档走 save_copy(sku, scenario_id, title, body, bullets),字段与展示内容一致。",
      "- 版本数由运营指定,默认 1 篇;要求多篇时每篇单独存档,风格拉开差异。",
    ].join("\n"),
    [
      "## Environment",
      `- Workspace: ${p.cfg.workspaceDir}`,
      `- Channel: ${p.channelType} (conversation ${p.conversationId}, session key ${p.sessionKey})`,
      `- Model: ${p.modelLabel}`,
    ].join("\n"),
    ["## Available tools", p.toolNames.map((n) => `- ${n}`).join("\n")].join("\n"),
  ];

  if (p.cfg.extraInstructions.length > 0) {
    sections.push(["## Additional instructions", ...p.cfg.extraInstructions].join("\n"));
  }

  return sections.join("\n\n");
}

/**
 * 生成 systemPromptOverride 闭包(签名对齐 DefaultResourceLoader)。
 * 有自定义 prompt 时**完整替换** pi 默认;没有时保留默认(返回 base)。
 */
export function createSystemPromptOverride(
  systemPrompt: string | undefined,
): (base: string | undefined) => string | undefined {
  return (base) => systemPrompt ?? base;
}
