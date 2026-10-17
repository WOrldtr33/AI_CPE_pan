// 有界 FIFO 队列：容量只计算等待任务，不包含正在执行的一个任务。
export class OperationQueue {
  constructor({ maxPending, waitTimeoutMs, error }) {
    this.maxPending = maxPending;
    this.waitTimeoutMs = waitTimeoutMs;
    this.error = error;
    this.pending = [];
    this.active = false;
    this.closed = false;
    this.idleWaiters = [];
  }
  // Promise 的 resolve/reject 对应调用者的结果；entry 保存任务及清理所需资源。
  enqueue(job, { signal, metadata }) {
    return new Promise((resolve, reject) => {
      const entry = { job, signal, metadata, resolve, reject, queuedAt: Date.now() };
      const fail = (code) =>
        this.error(code, {
          ...metadata,
          waitMs: Date.now() - entry.queuedAt,
          state: 'not_started',
          policy: 'fifo_per_device_instance',
        });
      if (this.closed) {
        reject(fail('SERVER_CLOSING'));
        return;
      }
      if (signal?.aborted) {
        reject(fail('CALL_CANCELLED'));
        return;
      }
      if (this.active && this.pending.length >= this.maxPending) {
        reject(fail('QUEUE_FULL'));
        return;
      }
      // 取消或等待超时都先移除任务，再释放计时器和监听，立即腾出等待位置。
      const remove = (code) => {
        const index = this.pending.indexOf(entry);
        if (index < 0) {
          return;
        }
        this.pending.splice(index, 1);
        this.cleanup(entry);
        reject(fail(code));
      };
      entry.abort = () => remove('CALL_CANCELLED');
      signal?.addEventListener('abort', entry.abort, { once: true });
      entry.timer = setTimeout(() => remove('QUEUE_WAIT_TIMEOUT'), this.waitTimeoutMs);
      this.pending.push(entry);
      this.drain();
    });
  }
  // 关闭后拒绝新任务，并通知所有等待任务；活动任务由上层控制收尾时间。
  close() {
    this.closed = true;
    for (const entry of this.pending.splice(0)) {
      this.cleanup(entry);
      entry.reject(
        this.error('SERVER_CLOSING', {
          ...entry.metadata,
          waitMs: Date.now() - entry.queuedAt,
          state: 'not_started',
          policy: 'fifo_per_device_instance',
        }),
      );
    }
    if (!this.active) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }
  // 开始执行或移出队列时都调用，避免等待计时器和监听残留。
  cleanup(entry) {
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.abort);
  }
  // active 保证最多执行一个任务。无论成功还是失败，都在 finally 中继续队列。
  drain() {
    if (this.active) {
      return;
    }
    const entry = this.pending.shift();
    if (!entry) {
      return;
    }
    this.active = true;
    this.cleanup(entry);
    Promise.resolve()
      .then(() =>
        entry.job({
          ...entry.metadata,
          waitMs: Date.now() - entry.queuedAt,
          policy: 'fifo_per_device_instance',
          state: 'started',
        }),
      )
      // 将任务结果交给调用者；finally 只负责释放执行权和唤醒关闭等待者。
      .then(entry.resolve, entry.reject)
      .finally(() => {
        this.active = false;
        this.drain();
        if (!this.active && !this.pending.length) {
          for (const resolve of this.idleWaiters.splice(0)) {
            resolve();
          }
        }
      });
  }
}
