/**
 * 按会话键串行的运行队列。对应真实 OpenClaw 的 pi-embedded-runner/runs.ts。
 *
 * - 同一会话键：串行（上一轮没跑完，下一轮排队）
 * - 不同会话键：并行
 */
export class RunQueue {
  private readonly chains = new Map<string, Promise<unknown>>();

  enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    // 前一轮失败不阻塞本轮（错误已经由调用方上报渠道）
    const next = prev.catch(() => undefined).then(fn);

    const swallowed = next.catch(() => undefined);
    this.chains.set(key, swallowed);
    // 队列收尾后清理，避免 Map 无限增长
    void swallowed.then(() => {
      if (this.chains.get(key) === swallowed) this.chains.delete(key);
    });

    return next;
  }
}
