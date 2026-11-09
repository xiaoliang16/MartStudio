/**
 * 工具适配器。对应真实 OpenClaw 的 pi-tool-definition-adapter.ts。
 *
 * 把内部的 CustomTool（渠道无关、返回纯文本）适配成 pi 的 ToolDefinition
 * （TypeBox schema + AgentToolResult）。工具的执行体在 pi 的 Agent Loop 里被调用。
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { CustomTool } from "./tools.js";

export function toToolDefinitions(tools: CustomTool[]): ToolDefinition[] {
  return tools.map((tool) =>
    defineTool({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const output = await tool.execute(params as Record<string, unknown>);
        return {
          content: [{ type: "text" as const, text: output }],
          details: { output },
        };
      },
    }),
  );
}
