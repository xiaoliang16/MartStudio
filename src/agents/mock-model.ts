/**
 * Mock 模型层。
 *
 * 为什么不自己写 HTTP 假服务？因为 pi-ai 内置了 `registerFauxProvider`，
 * 它是一个**进程内**的假模型 provider —— 真实 pi SDK 的 Agent Loop、工具执行、
 * 流式事件全部照常运行，只有"模型的思考"是假的。这比自建 SSE 服务更稳、更干净。
 *
 * 两种用法：
 *  1. 剧本模式：setResponses([...]) 固定返回，适合自动化测试/演示
 *  2. 智能模式：enableSmartResponder() 根据用户输入关键词决定是否调用工具，
 *     适合交互式 CLI（用户随便问，mock 也能"演"得像模像样）
 *
 * 生产环境只需把 mode 改成 "real"，本文件即可整体不再被使用。
 */
import {
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
  type FauxResponseFactory,
  type FauxResponseStep,
} from "@earendil-works/pi-ai/compat";
import type { AssistantMessage, Message, Model, TextContent, ToolCall } from "@earendil-works/pi-ai/compat";
import { NO_CARD_MARKER, NO_SKU_MARKER } from "./catalog-tools.js";

const MOCK_PROVIDER = "faux";
const MOCK_MODEL_ID = "mock-1";

export interface MockModelHandle {
  provider: string;
  getModel(): Model<any>;
  setResponses(steps: FauxResponseStep[]): void;
  appendResponses(steps: FauxResponseStep[]): void;
  enableSmartResponder(): void;
  /** 记录 mock 生成的每一次"决策"，便于演示与调试 */
  history: Array<{ call: number; kind: "tool" | "text"; detail: string }>;
  state: { callCount: number };
  unregister(): void;
}

/** 从消息里抽取文本 */
function messageText(message: Message): string {
  if (message.role === "user") {
    return typeof message.content === "string"
      ? message.content
      : message.content
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("");
  }
  if (message.role === "assistant") {
    return message.content
      .map((b) => {
        if (b.type === "text") return b.text;
        if (b.type === "thinking") return "";
        return `${b.name}:${JSON.stringify(b.arguments)}`;
      })
      .join("");
  }
  // toolResult 的 content 在 pi-ai 1.x 里可以是纯字符串
  if (typeof message.content === "string") return message.content;
  return message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

function lastUserText(messages: readonly Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") return messageText(m);
  }
  return "";
}

/** 把工具结果压成一段可读文本，作为"总结"的素材 */
function summarizeToolResults(messages: readonly Message[]): string {
  const results = messages.filter((m) => m.role === "toolResult");
  const last = results[results.length - 1];
  if (!last || last.role !== "toolResult") return "（没有拿到工具结果）";
  const body = last.content
    .map((b) => (b.type === "text" ? b.text : "[image]"))
    .join("\n")
    .trim();
  const clipped = body.length > 600 ? `${body.slice(0, 600)}\n…（已截断）` : body;
  return [
    `已调用工具 \`${last.toolName}\`${last.isError ? "（执行出错）" : ""}，结果如下：`,
    "",
    clipped || "（空输出）",
    "",
    last.isError ? "看起来这一步失败了，可以换个方式再试。" : "任务已完成。",
  ].join("\n");
}

interface Decision {
  kind: "tool" | "text";
  /** args 与 SDK 的 ToolCall.arguments 对齐（JsonObject） */
  tool?: { name: string; args: ToolCall["arguments"] };
  text?: string;
  detail: string;
}

const TOOL_RULES: Array<{
  re: RegExp;
  build: (text: string, msgs?: readonly Message[]) => Decision;
}> = [
  {
    re: /(文案|写一篇|详情页|种草|推文)/i,
    build: (text, msgs) => {
      // SKU 兜底顺序:本次文本命中 → 刚查过的商品(历史 get_product 调用) → 首次演示默认
      const sku = (
        text.match(/(SKU-[A-Za-z0-9-]+)/)?.[1] ??
        findToolCallArgs(msgs ?? [], "get_product")?.sku ??
        "SKU-1001"
      ).toString().toUpperCase();
      return {
        kind: "tool",
        tool: { name: "get_product", args: { sku } },
        detail: `get_product sku=${sku}（文案任务第一步）`,
      };
    },
  },
  {
    re: /(列出|目录|文件列表|有哪些文件|list\b|\bls\b)/i,
    build: (text) => ({
      kind: "tool",
      tool: { name: "ls", args: { path: "." } },
      detail: `ls path="."（因为你说：${text.slice(0, 30)}）`,
    }),
  },
  {
    re: /(执行|运行|跑一下|命令|shell|bash\b)/i,
    build: (text) => ({
      kind: "tool",
      tool: { name: "bash", args: { command: "echo mini-openclaw tool chain works" } },
      detail: "bash echo（演示命令执行）",
    }),
  },
  {
    re: /(搜索|查找|检索|grep\b)/i,
    build: (text) => ({
      kind: "tool",
      tool: { name: "grep", args: { pattern: "TODO" } },
      detail: 'grep pattern="TODO"',
    }),
  },
  {
    re: /(找文件|匹配文件|find\b|glob\b)/i,
    build: () => ({
      kind: "tool",
      tool: { name: "find", args: { pattern: "**/*.ts" } },
      detail: 'find pattern="**/*.ts"',
    }),
  },
  {
    re: /(读取|打开|查看|看看|read\b|cat\b)/i,
    build: (text) => {
      const file = extractFileName(text) ?? "package.json";
      return {
        kind: "tool",
        tool: { name: "read", args: { path: file } },
        detail: `read path="${file}"`,
      };
    },
  },
];

function extractFileName(text: string): string | undefined {
  // 注意：交替分支按"最长优先"排列，否则 `js` 会先于 `json` 命中
  const m = text.match(/[\w./\-]+\.(json|tsx|ya?ml|mjs|txt|md|py|ts|js)/i);
  return m ? m[0] : undefined;
}

/** mock 的场景识别规则（演示用；真实模式由模型经 select_scenario 判断） */
const SCENARIO_RULES: Array<{ re: RegExp; id: string; why: string }> = [
  { re: /(月底|月末|冲量|冲刺)/, id: "month_end_promo", why: "用户提到月底冲量" },
  { re: /(618|双11|双十一|大促|年货节|周年庆)/i, id: "mega_sale", why: "用户提到平台大促" },
  { re: /(预售|定金)/, id: "pre_sale", why: "用户提到预售" },
  { re: /(新品|首发|上新)/, id: "new_launch", why: "用户提到新品" },
  { re: /(清仓|尾货|断码|骨折)/, id: "clearance", why: "用户提到清仓" },
  { re: /(送礼|礼盒|中秋|母亲节|父亲节|春节)/, id: "festival", why: "用户提到节日礼赠" },
  { re: /(会员|老客|召回)/, id: "membership", why: "用户提到会员/老客" },
  { re: /(种草|小红书|笔记)/, id: "seeding", why: "用户提到种草内容" },
  { re: /(打折|折扣|特惠|降价)/, id: "regular_discount", why: "用户提到日常打折" },
];

function pickScenario(text: string): { id: string; why: string } {
  for (const r of SCENARIO_RULES) if (r.re.test(text)) return { id: r.id, why: r.why };
  return { id: "everyday", why: "未识别到促销信号，按日常销售处理" };
}

/** 从历史消息找某工具最近一次调用的参数（跨步取 SKU/场景，不依赖块类型字面量） */
function findToolCallArgs(messages: readonly Message[], name: string): ToolCall["arguments"] | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    for (const b of m.content) {
      if ("name" in b && b.name === name && "arguments" in b) return b.arguments;
    }
  }
  return undefined;
}

/** mock 占位成稿（真实模式下由模型依据商品参数+风格卡生成） */
function demoCopy(sku: string, scenarioId: string): { title: string; body: string; bullets: string[] } {
  return {
    title: `【Mock 演示】${sku} · ${scenarioId} 场景文案`,
    body: `这是 ${sku} 在 ${scenarioId} 场景下的演示正文。真实模型模式下，这里会依据商品参数、品类风格卡与场景策略卡生成完整内容。`,
    bullets: ["卖点一：来自商品 sellingPoints", "卖点二：参数背书", "卖点三：场景化行动号召"],
  };
}

function classify(text: string, msgs?: readonly Message[]): Decision {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { kind: "text", text: "（空消息）你想让我做点什么？", detail: "empty" };
  }
  for (const rule of TOOL_RULES) {
    if (rule.re.test(trimmed)) return rule.build(trimmed, msgs);
  }
  return {
    kind: "text",
    text: buildChatReply(trimmed),
    detail: "纯文本回复",
  };
}

const CANNED: Array<{ re: RegExp; reply: string }> = [
  {
    re: /(你好|hi\b|hello\b|在吗)/i,
    reply:
      "你好，我是电商文案助手 👋\n目前接的是本地 Mock 模型。试着说「给 SKU-1001 写一篇月底促销文案」，看我把 查商品→选场景→存文案 全链路走一遍。",
  },
  {
    re: /(你是谁|介绍|什么|who are you)/i,
    reply:
      "我是一个「迷你 OpenClaw」：Gateway + Channel + 嵌入式 pi Agent + JSONL 会话持久化。\n模型层是可替换的 —— 换成真实 API Key 就是我生产版的样子。",
  },
  {
    re: /(工具|tools?|能力)/i,
    reply:
      "我挂了这些工具：select_scenario / get_product / list_products / save_copy，以及内置的 read / ls / bash / grep / find。\n说「给 SKU-1001 写一篇月底促销文案」我会真的调用它们。",
  },
];

function buildChatReply(text: string): string {
  for (const c of CANNED) {
    if (c.re.test(text)) return c.reply;
  }
  return [
    `我收到了你的消息：「${text.slice(0, 80)}」`,
    "",
    "（当前是 Mock 模型，不会真的推理。但整条链路是真实的：消息 → Gateway → pi Agent → 事件流 → 回传。）",
    "",
    "想看我调用工具，可以说：",
    "· 给 SKU-1001 写一篇月底促销文案",
    "· 列出当前目录的文件",
    "· 读取 package.json",
  ].join("\n");
}

/**
 * 智能 responder：每次被调用时先把自己重新塞回队列，实现"无限剧本"。
 */
function createSmartResponder(handle: () => MockModelHandle): FauxResponseFactory {
  // 参数交给 FauxResponseFactory 上下文推断（1.x 的 context 是 TranscriptContext）
  const factory: FauxResponseFactory = (context, _options, state) => {
    // 重新排队，保证永远有下一个响应
    handle().appendResponses([factory]);

    const msgs = context.messages;
    const last = msgs[msgs.length - 1];

    // 上一个消息是工具结果 → 按"上一个工具"推进 文案链路状态机：查商品→选场景→存文案
    if (last?.role === "toolResult") {
      const resultText = messageText(last);

      // ---- 文案链路状态机 ----
      if (last.toolName === "get_product") {
        if (resultText.includes(NO_CARD_MARKER) || resultText.includes(NO_SKU_MARKER)) {
          return fauxAssistantMessage(
            ["先暂停动笔，这一步需要人工确认：", "", resultText.slice(0, 600), "", "请运营确认后告诉我怎么继续。"].join("\n"),
          );
        }
        const pick = pickScenario(lastUserText(msgs));
        return fauxAssistantMessage([
          { type: "text" as const, text: `商品信息已拿到，接下来确认销售场景（${pick.why}）。\n` } satisfies TextContent,
          fauxToolCall("select_scenario", { scenario_id: pick.id, rationale: pick.why }) as ToolCall,
        ]);
      }
      if (last.toolName === "select_scenario") {
        const sku = String(findToolCallArgs(msgs, "get_product")?.sku ?? "SKU-1001");
        const scenarioId = String(findToolCallArgs(msgs, "select_scenario")?.scenario_id ?? "everyday");
        const copy = demoCopy(sku, scenarioId);
        return fauxAssistantMessage([
          {
            type: "text" as const,
            text: [
              `场景与商品都已就绪，这是我为 ${sku} 准备的文案：`,
              "",
              `# ${copy.title}`,
              "",
              copy.body,
              "",
              "卖点：",
              ...copy.bullets.map((b) => `- ${b}`),
              "",
              "现在保存到文案库。",
            ].join("\n"),
          } satisfies TextContent,
          fauxToolCall("save_copy", {
            sku,
            scenario_id: scenarioId,
            title: copy.title,
            body: copy.body,
            bullets: copy.bullets,
          }) as ToolCall,
        ]);
      }
      if (last.toolName === "save_copy") {
        return fauxAssistantMessage("✅ 文案已存档，任务完成。存档路径见上一步工具结果。");
      }
      return fauxAssistantMessage(summarizeToolResults(msgs));
    }

    const userText = lastUserText(msgs);
    const decision = classify(userText, msgs);

    handle().history.push({
      call: state.callCount,
      kind: decision.kind,
      detail: decision.detail,
    });

    const blocks = [];
    if (decision.kind === "tool" && decision.tool) {
      blocks.push({
        type: "text" as const,
        text: `好的，我先调用工具 \`${decision.tool.name}\`：${decision.detail}\n`,
      } satisfies TextContent);
      blocks.push(fauxToolCall(decision.tool.name, decision.tool.args));
      return fauxAssistantMessage(blocks);
    }
    return fauxAssistantMessage(decision.text ?? "（mock 无回复）");
  };
  return factory;
}

/** 注册 Mock provider 并返回句柄 */
export function createMockModel(options: { tokensPerSecond?: number } = {}): MockModelHandle {
  const faux = registerFauxProvider({
    provider: MOCK_PROVIDER,
    models: [
      {
        id: MOCK_MODEL_ID,
        name: "Mini-OpenClaw Mock Model",
        reasoning: false,
        input: ["text"],
      },
    ],
    // 让流式输出可见（默认是瞬时的）
    tokensPerSecond: options.tokensPerSecond ?? 180,
  });

  const history: MockModelHandle["history"] = [];

  // 解析一次并缓存，避免每次调用都返回可能为 undefined 的值
  const resolvedModel = faux.getModel(MOCK_MODEL_ID) ?? faux.models[0];
  if (!resolvedModel) throw new Error("Faux provider 未返回任何模型");

  const handle: MockModelHandle = {
    provider: MOCK_PROVIDER,
    getModel: () => resolvedModel,
    setResponses: (steps) => faux.setResponses(steps),
    appendResponses: (steps) => faux.appendResponses(steps),
    enableSmartResponder: () => {
      faux.setResponses([createSmartResponder(() => handle)]);
    },
    history,
    state: faux.state,
    unregister: () => faux.unregister(),
  };

  return handle;
}

/** 供演示脚本使用：一段确定性剧本（tool_call → summary） */
export function scriptedToolCallScenario(toolName: string, args: ToolCall["arguments"], summary: string): FauxResponseStep[] {
  return [
    fauxAssistantMessage([
      { type: "text", text: `我来调用 \`${toolName}\` 工具。\n` } satisfies TextContent,
      fauxToolCall(toolName, args) as ToolCall,
    ]),
    fauxAssistantMessage(summary),
  ];
}

export type { AssistantMessage };
