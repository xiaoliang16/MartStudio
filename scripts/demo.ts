/**
 * 一次性演示脚本：跑通三大场景并打印结构化报告。
 *
 *   pnpm demo
 *
 * 场景：
 *   1. 纯文本回复（验证 Gateway → pi → 流式回传）
 *   2. 工具调用循环（验证 Agent Loop：tool_execution_start/end → 总结）
 *   3. 多轮会话记忆 + /new 会话隔离（验证 JSONL 持久化）
 */
import { readFileSync, rmSync } from "node:fs";
import { createMockModel } from "../src/agents/mock-model.js";
import { createModelLayer } from "../src/agents/model.js";
import { RecordingChannel } from "../src/channels/recording.js";
import { defaultConfig } from "../src/config.js";
import { Gateway } from "../src/gateway/gateway.js";
import { listSessionFiles } from "../src/agents/session-store.js";

function readFileSyncSafe(path: string): number {
  try {
    return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

const C = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  magenta: "\u001b[35m",
};

function heading(n: string, title: string): void {
  console.log(`\n${C.bold}${C.magenta}━━━ ${n} ━ ${title} ${"━".repeat(Math.max(0, 46 - title.length))}${C.reset}\n`);
}

function showUser(text: string): void {
  console.log(`${C.cyan}👤 用户：${C.reset}${text}`);
}

function showStatuses(lines: string[]): void {
  for (const l of lines) console.log(`   ${C.yellow}${l}${C.reset}`);
}

function showReply(text: string): void {
  const indented = text
    .split("\n")
    .map((l) => `   ${l}`)
    .join("\n");
  console.log(`${C.green}🦞 Agent：${C.reset}\n${indented}`);
}

async function main(): Promise<void> {
  const cfg = defaultConfig(process.cwd());
  // 每次演示从干净状态开始
  rmSync(cfg.stateDir, { recursive: true, force: true });

  const mock = createMockModel({ tokensPerSecond: 0 }); // 0 = 不模拟延迟，跑得快
  mock.enableSmartResponder();

  const modelLayer = await createModelLayer(cfg, mock);
  const gateway = new Gateway({ cfg, modelLayer, modelLabel: `faux/${modelLayer.model.id} (本地 Mock)` });
  const channel = new RecordingChannel({ conversationId: "demo" });
  gateway.registerChannel(channel);
  await gateway.start();

  console.log(`${C.bold}🦞 Mini-OpenClaw 演示${C.reset}`);
  console.log(`${C.dim}工作区：${cfg.workspaceDir}`);
  console.log(`状态目录：${cfg.stateDir}`);
  console.log(`模型：faux/${modelLayer.model.id}（进程内 Mock，无需 API Key）${C.reset}`);

  // ───────────────────────────── 场景 1 ─────────────────────────────
  heading("场景 1", "纯文本回复");
  showUser("你好，你是谁？");
  channel.clear();
  await channel.inject("你好，你是谁？");
  showStatuses(channel.statuses());
  showReply(channel.blocks().join("\n"));

  // ───────────────────────────── 场景 2 ─────────────────────────────
  heading("场景 2", "工具调用循环（Agent Loop）");
  showUser("列出当前目录的文件");
  channel.clear();
  await channel.inject("列出当前目录的文件");
  showStatuses(channel.statuses());
  showReply(channel.blocks().join("\n"));
  console.log(
    `\n${C.dim}↑ 注意上面：模型先请求 ls 工具 → pi 执行工具 → 工具结果回灌 → 模型再生成总结。${C.reset}`,
  );

  // ───────────────────────────── 场景 3 ─────────────────────────────
  heading("场景 3", "多轮记忆与会话隔离");
  showUser("读取 package.json");
  channel.clear();
  await channel.inject("读取 package.json");
  showStatuses(channel.statuses());
  showReply(channel.blocks().join("\n"));

  console.log(`\n${C.dim}—— 紧接着问一个依赖上下文的问题 ——${C.reset}`);
  showUser("执行一个命令");
  channel.clear();
  await channel.inject("执行一个命令");
  showStatuses(channel.statuses());
  showReply(channel.blocks().join("\n"));

  const before = listSessionFiles(cfg, "main:demo:demo");
  console.log(`\n${C.dim}会话文件（连续对话写同一个 JSONL）：${C.reset}`);
  for (const f of before) console.log(`   · ${f.split("/").pop()}`);

  console.log(`\n${C.dim}—— 发送 /new 开启新会话，然后接着聊一句 ——${C.reset}`);
  showUser("/new");
  channel.clear();
  await channel.inject("/new");
  showStatuses(channel.statuses());

  showUser("你好");
  channel.clear();
  await channel.inject("你好");
  showReply(channel.blocks().join("\n"));

  const after = listSessionFiles(cfg, "main:demo:demo");
  console.log(`\n${C.dim}会话文件（/new 后新开了一个，与旧会话完全隔离）：${C.reset}`);
  for (const f of after) {
    const lines = readFileSyncSafe(f);
    console.log(`   · ${f.split("/").pop()}  (${lines} 条记录)`);
  }

  // ───────────────────────────── 汇总 ─────────────────────────────
  heading("汇总", "运行统计");
  console.log(`   收到的消息：${gateway.stats.messagesIn}`);
  console.log(`   运行次数：${gateway.stats.runs}（失败 ${gateway.stats.runsFailed}）`);
  console.log(`   工具调用：${gateway.stats.toolCalls}`);
  console.log(`   Mock 模型调用次数：${mock.state.callCount}`);
  console.log(`   会话文件数：${after.length}`);

  const jsonlFile = after[after.length - 1];
  console.log(`\n${C.dim}会话文件内容（JSONL 前 2 行）：${C.reset}`);
  const lines = readFileSync(jsonlFile, "utf8").trim().split("\n").slice(0, 2);
  for (const l of lines) {
    console.log(`   ${C.dim}${l.length > 150 ? `${l.slice(0, 150)}…` : l}${C.reset}`);
  }

  await gateway.stop();
  console.log(`\n${C.green}✅ 演示完成${C.reset}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("演示失败：", err);
  process.exit(1);
});
