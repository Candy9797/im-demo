/**
 * MessageQueue - 高频消息队列（批处理、去重、重试）
 *
 * 场景：群聊、行情推送等每秒数十条消息
 * 能力：入站批处理减少 setState；出站批处理降低帧数；5s 窗口去重；发送失败指数退避重试
 * 模式：生产者-消费者，flushInterval 定时 flush
 *
 * 待确认队列（Pending-Ack）：send 后消息移入 pendingAck，ACK 到达才移除；
 * 断线时 rollbackPendingAck 将未确认消息回滚到 outgoing，重连后重发。
 * 批处理	定时 flush 每批处理，降低 ws 帧数和 setState 次数
pendingAck	已发出但未 ACK 的消息，断线时回滚，重连后重发
ACK 超时	超时未 ACK 则重发，重试次数用尽则标记失败
入站去重	seenIds 在时间窗口内去重，避免重复消息
先入后出	flush 时先处理入站再处理出站，优先展示收到的新消息
 */

import { type Message, MessageStatus } from "./types";

/** 队列配置 */
interface QueueConfig {
  maxSize: number; // 队列最大长度，超限丢弃最旧
  batchSize: number; // 每批处理条数
  flushInterval: number; // 批量 flush 间隔（毫秒）
  retryAttempts: number; // 发送失败最大重试次数
  retryDelay: number; // 重试间隔基数（指数退避）
  deduplicationWindow: number; // 去重时间窗口（毫秒）
  ackTimeoutMs: number; // ACK 超时（毫秒），超时未收到 ACK 则重发
}

/** 默认配置 */
const DEFAULT_CONFIG: QueueConfig = {
  maxSize: 1000,
  batchSize: 20,
  flushInterval: 100, // 100ms batch window — ~10 flushes/second
  retryAttempts: 3,
  retryDelay: 1000,
  deduplicationWindow: 5000,
  ackTimeoutMs: 10000, // 10s
};

/** 待发消息（含重试次数与入队时间） */
interface PendingMessage {
  message: Message;
  attempts: number; // 已尝试次数
  addedAt: number; // 入队时间戳
}

export class MessageQueue {
  private config: QueueConfig;
  private outgoing: PendingMessage[] = []; // 待发队列
  /** 已发送但未收到 ACK 的消息，断线时回滚到 outgoing */
  private pendingAck: Map<string, PendingMessage> = new Map();
  /** ACK 超时定时器：clientMsgId -> timer */
  private ackTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private incoming: Message[] = []; // 待处理入站队列
  private seenIds: Map<string, number> = new Map(); // 去重缓存：id -> 时间戳
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private onFlushOutgoing: ((messages: Message[]) => Promise<void>) | null =
    null; // 实际发送到 ws
  private onFlushIncoming: ((messages: Message[]) => void) | null = null; // 实际派发到 UI
  private onMessageSendFailed: ((message: Message) => void) | null = null; // 重试耗尽回调
  private _isPaused = false; // 断线时暂停，重连后恢复

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 启动队列：定时 flush，并注册出站/入站/失败回调
   * @param onMessageSendFailed 可选，重试耗尽时回调（用于 MESSAGE_SEND_FAILED）
   */
  start(
    onFlushOutgoing: (messages: Message[]) => Promise<void>,
    onFlushIncoming: (messages: Message[]) => void,
    onMessageSendFailed?: (message: Message) => void
  ): void {
    this.onFlushOutgoing = onFlushOutgoing;
    this.onFlushIncoming = onFlushIncoming;
    this.onMessageSendFailed = onMessageSendFailed ?? null;

    this.flushTimer = setInterval(() => {
      if (!this._isPaused) {
        this.flush();
      }
    }, this.config.flushInterval);
  }

  /**
   * 立即 flush 出站队列（用于突发模式压测，不等定时器）
   */
  async forceFlushOutgoing(): Promise<void> {
    if (!this._isPaused && this.outgoing.length > 0) {
      await this.flushOutgoing();
    }
  }

  /**
   * 停止队列：清除 flush 定时器与 ACK 超时定时器
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    for (const timer of this.ackTimers.values()) {
      clearTimeout(timer);
    }
    this.ackTimers.clear();
  }

  /**
   * 暂停队列处理（如断线重连期间）
   */
  pause(): void {
    this._isPaused = true;
  }

  /**
   * 恢复队列处理（重连成功后）
   */
  resume(): void {
    this._isPaused = false;
  }

  /**
   * 入队待发消息，队列满时丢弃最旧的非 sending 消息
   */
  enqueueOutgoing(message: Message): boolean {
    if (this.outgoing.length >= this.config.maxSize) {
      // Drop oldest non-sending message
      const dropIndex = this.outgoing.findIndex(
        (p) => p.message.status !== MessageStatus.SENDING
      );
      if (dropIndex !== -1) {
        this.outgoing.splice(dropIndex, 1);
      } else {
        console.warn("[MessageQueue] Queue full, dropping message");
        return false;
      }
    }

    this.outgoing.push({
      message,
      attempts: 0,
      addedAt: Date.now(),
    });
    return true;
  }

  /**
   * 入队入站消息，带去重（seenIds 窗口内重复则丢弃）
   */
  enqueueIncoming(message: Message): boolean {
    // Deduplication check
    if (this.isDuplicate(message.id)) {
      return false;
    }

    this.seenIds.set(message.id, Date.now());
    this.incoming.push(message);

    // Cleanup old dedup entries
    this.cleanupDedup();
    return true;
  }

  /**
   * 批量处理：先 flush 入站，再 flush 出站
   */
  private async flush(): Promise<void> {
    this.flushIncoming();
    await this.flushOutgoing();
  }

  /**
   * 将入站队列中的一批消息交给 onFlushIncoming 处理
   */
  private flushIncoming(): void {
    if (this.incoming.length === 0 || !this.onFlushIncoming) return;

    const batch = this.incoming.splice(0, this.config.batchSize);
    this.onFlushIncoming(batch);
  }

  /**
   * Flush outgoing messages to the send handler.
   * 发送成功后移入 pendingAck，等 ACK 到达后由 onAck 移除；
   * 断线时 rollbackPendingAck 将未确认消息回滚到 outgoing 重发。
   */
  private async flushOutgoing(): Promise<void> {
    if (this.outgoing.length === 0 || !this.onFlushOutgoing) return;

    const batch = this.outgoing.splice(0, this.config.batchSize);
    const messages = batch.map((p) => {
      p.attempts++;
      return p.message;
    });

    try {
      await this.onFlushOutgoing(messages);
      // 发送成功（已写入 ws 缓冲区），移入待确认队列，启动 ACK 超时定时器
      for (const pending of batch) {
        const clientMsgId = pending.message.id;
        this.pendingAck.set(clientMsgId, pending);
        const timer = setTimeout(
          () => this.handleAckTimeout(clientMsgId),
          this.config.ackTimeoutMs
        );
        this.ackTimers.set(clientMsgId, timer);
      }
    } catch {
      // ws.send 抛错（如已断开），回队或标记失败
      for (const pending of batch) {
        if (pending.attempts < this.config.retryAttempts) {
          this.outgoing.unshift(pending);
        } else {
          this.markSendFailed(pending);
        }
      }
    }
  }

  /** 收到 ACK，从待确认队列移除，清除超时定时器 */
  onAck(clientMsgId: string): void {
    const timer = this.ackTimers.get(clientMsgId);
    if (timer) {
      clearTimeout(timer);
      this.ackTimers.delete(clientMsgId);
    }
    this.pendingAck.delete(clientMsgId);
  }

  /** ACK 超时：未收到 ACK，回队重发或标记失败 */
  private handleAckTimeout(clientMsgId: string): void {
    this.ackTimers.delete(clientMsgId);
    const pending = this.pendingAck.get(clientMsgId);
    if (!pending) return;
    this.pendingAck.delete(clientMsgId);
    if (pending.attempts < this.config.retryAttempts) {
      this.outgoing.unshift(pending);
    } else {
      this.markSendFailed(pending);
    }
  }

  /**
   * 断线时调用：将 pendingAck 中未确认消息回滚到 outgoing，重连后重发
   */
  rollbackPendingAck(): void {
    for (const [clientMsgId, pending] of this.pendingAck) {
      const timer = this.ackTimers.get(clientMsgId);
      if (timer) {
        clearTimeout(timer);
        this.ackTimers.delete(clientMsgId);
      }
      if (pending.attempts < this.config.retryAttempts) {
        this.outgoing.unshift(pending);
      } else {
        this.markSendFailed(pending);
      }
    }
    this.pendingAck.clear();
  }

  /** 标记消息发送失败，并回调 onMessageSendFailed */
  private markSendFailed(pending: PendingMessage): void {
    console.error(
      `[MessageQueue] Message ${pending.message.id} failed after ${this.config.retryAttempts} attempts`
    );
    pending.message.status = MessageStatus.FAILED;
    this.onMessageSendFailed?.(pending.message);
  }

  /**
   * 判断消息 ID 是否在去重窗口内已见过
   */
  private isDuplicate(id: string): boolean {
    return this.seenIds.has(id);
  }

  /**
   * 清理超出 deduplicationWindow 的 seenIds 条目
   */
  private cleanupDedup(): void {
    const cutoff = Date.now() - this.config.deduplicationWindow;
    for (const [id, ts] of this.seenIds) {
      if (ts < cutoff) {
        this.seenIds.delete(id);
      }
    }
  }

  /**
   * 获取队列统计（用于调试/监控）
   */
  getStats() {
    return {
      outgoingSize: this.outgoing.length,
      pendingAckSize: this.pendingAck.size,
      incomingSize: this.incoming.length,
      deduplicationCacheSize: this.seenIds.size,
      isPaused: this._isPaused,
    };
  }

  /** 当前待发消息数量 */
  get pendingCount(): number {
    return this.outgoing.length;
  }
}
