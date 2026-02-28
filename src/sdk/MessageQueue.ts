/**
 * MessageQueue - 高频消息队列（批处理、去重、重试）
 *
 * 场景：群聊、行情推送等每秒数十条消息
 * 能力：入站批处理减少 setState；出站批处理降低帧数；5s 窗口去重；发送失败/ACK 超时自动重试
 * 模式：生产者-消费者，flushInterval 定时 flush
 *
 * --- 何时会重发（同一条消息可能被再次发送）---
 * 1. 发送失败：flushOutgoing 里 onFlushOutgoing（如 ws.send）抛错时，消息 unshift 回 outgoing，
 *    下次 flush 会自动再发；最多重试 retryAttempts 次，超过则 markSendFailed。
 * 2. ACK 超时：消息发成功后进入 pendingAck 并设 ackTimeoutMs 定时器；超时未收到服务端 message_ack，
 *    则 handleAckTimeout 把该消息移回 outgoing 队头，下次 flush 自动再发；同样受 retryAttempts 限制。
 * 3. 断线回滚：DISCONNECTED 时 IMClient 调 rollbackPendingAck，把 pendingAck 里未确认消息全部移回 outgoing，
 *    重连后 resume 恢复定时 flush，这些消息会在后续 flush 中自动重发（仍受 retryAttempts 限制）。
 *
 * 待确认队列（Pending-Ack）：send 后消息移入 pendingAck，ACK 到达才移除；
 * 断线时 rollbackPendingAck 将未确认消息回滚到 outgoing，重连后重发。
 * 入站去重：seenIds 在时间窗口内去重，避免重复展示。先入后出：flush 时先处理入站再出站。
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
  // 消息发出去后如果 10 秒内没收到服务端的 message_ack，就会触发 handleAckTimeout，按重试次数回队重发或标记失败
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
    onMessageSendFailed?: (message: Message) => void,
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
        (p) => p.message.status !== MessageStatus.SENDING,
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
   * 发送成功后移入 pendingAck，等 ACK 到达后由 onAck 移除；断线时 rollbackPendingAck 回滚重发。
   *
   * 会触发重发的两种情况（均为自动，无需业务调用）：
   * - onFlushOutgoing 抛错：本批消息 unshift 回 outgoing，下次 flush 再发（attempts 超限则 markSendFailed）。
   * - 本批发成功后：每条在 pendingAck 中挂 ackTimeoutMs 定时器，超时未 onAck 则 handleAckTimeout 回队重发。
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
          this.config.ackTimeoutMs,
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

  /**
   * ACK 超时：发成功后 ackTimeoutMs 内未收到服务端 message_ack，视为可能丢包，回队重发或标记失败。
   * attempts < retryAttempts 则 unshift 回 outgoing（下次 flush 自动再发），否则 markSendFailed。
   */
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
   * 断线时调用（由 IMClient 在 DISCONNECTED 时调用）：将 pendingAck 中「已发出但未收到 ACK」的消息
   * 全部移回 outgoing 队头，并清除 ACK 超时定时器。重连后 resume 恢复 flush，这些消息会在后续
   * flush 中自动重发（仍受 retryAttempts 限制，超限则 markSendFailed）。
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
      `[MessageQueue] Message ${pending.message.id} failed after ${this.config.retryAttempts} attempts`,
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
