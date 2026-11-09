/**
 * 内部工具接口(渠道无关)。业务工具(catalog-tools / scenario-tools / copy-tools)
 * 与适配器(tool-adapter.ts)都依赖这个接口;具体工具在各 *-tools.ts 中定义。
 */
import type { TSchema } from "typebox";

export interface CustomTool {
  name: string;
  description: string;
  /** TypeBox 参数 schema */
  parameters: TSchema;
  execute(args: Record<string, unknown>): Promise<string>;
}
