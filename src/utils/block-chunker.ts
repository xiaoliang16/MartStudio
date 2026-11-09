/**
 * 流式文本分块器。对应真实 OpenClaw 的 pi-embedded-block-chunker.ts。
 *
 * IM 类渠道不适合 token 级刷屏（一条 partial 一条消息会把聊天记录打爆），
 * 所以把流式增量按「句 / 段」聚合成块，块与块之间作为独立消息发送。
 *
 * 规则：
 *  - 中文句末标点（。！？…) 与英文 !? 直接断句
 *  - 英文 `.` 只有后面跟空白或行尾才算句末 —— 避免 `./src/`、`3.14` 被切断
 *  - 换行 / 空行是更强的边界（段落），无条件切
 *  - 短于最小块长度的句子会攒到下一个边界，避免碎片消息
 */
const MIN_BLOCK_CHARS = 24;

/** 句末标点（中文优先；省略号按单字符处理） */
const SENTENCE_ENDERS = new Set(["。", "！", "？", "…", "!", "?"]);
/** 断句后可以一并吞掉的收尾字符 */
const TRAILING = new Set(["」", "』", "）", ")", "\"", "'", "”", "’"]);

export class BlockChunker {
  private buffer = "";

  /** 喂入一段流式增量，返回因此释放出的完整块 */
  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    let i = 0;
    while (i < this.buffer.length) {
      const end = this.boundaryEnd(i);
      if (end === 0) {
        i++;
        continue;
      }
      const block = this.buffer.slice(0, end);
      const isParagraph = this.buffer[end - 1] === "\n";
      if (isParagraph || block.trim().length >= MIN_BLOCK_CHARS) {
        const trimmed = block.trim();
        if (trimmed.length > 0) out.push(trimmed);
        this.buffer = this.buffer.slice(end);
        i = 0;
      } else {
        // 太短，攒着
        i++;
      }
    }
    return out;
  }

  /** 冲刷残留文本（一轮对话结束时调用） */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest.length > 0 ? [rest] : [];
  }

  /**
   * 判断 buffer[i] 是否构成边界。
   * @returns 需要消费的字符数（含吸收的空白），0 表示不是边界
   */
  private boundaryEnd(i: number): number {
    const ch = this.buffer[i];
    const next = this.buffer[i + 1];

    // 换行：段落边界
    if (ch === "\n") {
      let end = i + 1;
      while (this.buffer[end] === "\n" || this.buffer[end] === " " || this.buffer[end] === "\t") end++;
      return end;
    }

    if (SENTENCE_ENDERS.has(ch)) {
      let end = i + 1;
      while (TRAILING.has(this.buffer[end] ?? "")) end++;
      while (this.buffer[end] === " " || this.buffer[end] === "\t") end++;
      return end;
    }

    // 英文句点：后随空白/换行才算句末（后面还没有字符时先不动，等下一个增量）
    if (ch === "." && (next === " " || next === "\t" || next === "\n")) {
      let end = i + 1;
      while (this.buffer[end] === " " || this.buffer[end] === "\t") end++;
      return end;
    }

    return 0;
  }
}
