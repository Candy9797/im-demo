/**
 * MessageQueue - 高频消息队列（批处理、去重、重试）
 *
 * 上层 IMClient 将待发消息 enqueueOutgoing、将收到的消息 enqueueIncoming；本类按 flushInterval 定时 flush，
 * 先 flushIncoming（批交给 onFlushIncoming 派发到 UI），再 flushOutgoing（批交给 onFlushOutgoing 发到 WS）。
 *
 * --- 一、场景与能力 ---
 * 场景：群聊、行情推送等每秒数十条消息。
 * 能力：入站批处理减少 setState 次数；出站批处理降低 WebSocket 帧数；deduplicationWindow 内按 id 去重避免重复展示；
 *       发送失败或 ACK 超时自动重试（受 retryAttempts 限制），超限则 markSendFailed 并回调 onMessageSendFailed。
 * 模式：生产者-消费者，start() 后按 flushInterval 定时 flush；pause/resume 用于断线时暂停、重连后恢复。
 *
 * --- 二、队列与状态 ---
 * outgoing：待发队列，flush 时取一批交给 onFlushOutgoing 发送；发送成功后移入 pendingAck。
 * pendingAck：已发出但未收到服务端 message_ack 的消息；收到 onAck(clientMsgId) 时移除；断线时 rollbackPendingAck 回滚到 outgoing。
 * incoming：待处理入站队列，flush 时取一批交给 onFlushIncoming；enqueueIncoming 时用 seenIds 做窗口内去重。
 * seenIds：id -> 时间戳，用于入站去重；cleanupDedup 定期清理超出 deduplicationWindow 的条目。
 *
 * --- 三、何时会重发（同一条消息可能被再次发送）---
 * 1. 发送失败：flushOutgoing 里 onFlushOutgoing（如 ws.send）抛错时，本批消息 unshift 回 outgoing，下次 flush 再发；attempts 超 retryAttempts 则 markSendFailed。
 * 2. ACK 超时：消息发成功后进入 pendingAck 并设 ackTimeoutMs 定时器；超时未收到 message_ack 则 handleAckTimeout 将该条移回 outgoing 队头，下次 flush 再发；同样受 retryAttempts 限制。
 * 3. 断线回滚：DISCONNECTED 时 IMClient 调 rollbackPendingAck，将 pendingAck 中未确认消息全部移回 outgoing，重连后 resume，后续 flush 中自动重发（仍受 retryAttempts 限制）。
 *
 * --- 四、执行顺序 ---
 * flush() 每次先 flushIncoming() 再 flushOutgoing()，保证先处理收再处理发；start() 注册 onFlushOutgoing、onFlushIncoming、onMessageSendFailed。
 *
 * --- 五、相关文件 ---
 * 使用方：IMClient 创建 MessageQueue、start 时传入发送/入站/失败回调，连接状态变化时 pause/resume/rollbackPendingAck；类型见 types.ts Message、MessageStatus。
 */

import { type Message, MessageStatus } from "./types";

/** 队列配置：容量、批大小、flush 周期、重试与去重参数 */
interface QueueConfig {
  maxSize: number;           // 待发队列最大长度，超限时丢弃最旧的一条非 sending 消息（若全是 sending 则拒绝入队）
  batchSize: number;         // 每批从 outgoing/incoming 取出的条数
  flushInterval: number;     // 定时 flush 间隔（毫秒），如 100 表示约每秒 10 次 flush
  retryAttempts: number;     // 发送失败或 ACK 超时后最多重试次数，超过则 markSendFailed
  retryDelay: number;        // 重试间隔基数（当前实现未用于退避，仅保留配置）
  deduplicationWindow: number; // 入站去重时间窗口（毫秒），窗口内相同 id 只保留第一条
  ackTimeoutMs: number;      // 消息发出后等待服务端 message_ack 的超时（毫秒），超时则 handleAckTimeout 回队重发或标记失败
}

/** 默认配置（可被构造函数传入的 config 覆盖） */
const DEFAULT_CONFIG: QueueConfig = {
  maxSize: 1000,
  batchSize: 20,
  flushInterval: 100,
  retryAttempts: 3,
  retryDelay: 1000,
  deduplicationWindow: 5000,
  ackTimeoutMs: 10000,
};

/** 待发消息包装：携带原始 Message、已尝试次数（用于重试上限）、入队时间戳 */
interface PendingMessage {
  message: Message;
  attempts: number;
  addedAt: number;
}

export class MessageQueue {
  private config: QueueConfig;
  /** 待发队列：enqueueOutgoing 入队，flushOutgoing 按 batchSize 取出交给 onFlushOutgoing */
  private outgoing: PendingMessage[] = [];
  /** 已发送但未收到 ACK 的消息（key 为 message.id）；收到 onAck 移除，断线时 rollbackPendingAck 回滚到 outgoing */
  private pendingAck: Map<string, PendingMessage> = new Map();
  /** 每条 pendingAck 消息对应一个 ACK 超时定时器，超时则 handleAckTimeout */
  private ackTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  /** 待处理入站队列：enqueueIncoming 入队（带去重），flushIncoming 按 batchSize 取出交给 onFlushIncoming */
  private incoming: Message[] = [];
  /** 入站去重缓存：message.id -> 最近一次入队时间戳，cleanupDedup 清理超窗条目 */
  private seenIds: Map<string, number> = new Map();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  /** 出站批发送回调（如通过 WebSocketManager 发帧），start() 时注册 */
  private onFlushOutgoing: ((messages: Message[]) => Promise<void>) | null = null;
  /** 入站批处理回调（如写 store、派发 MESSAGE_RECEIVED），start() 时注册 */
  private onFlushIncoming: ((messages: Message[]) => void) | null = null;
  /** 重试耗尽时回调（如派发 MESSAGE_SEND_FAILED），start() 时可选注册 */
  private onMessageSendFailed: ((message: Message) => void) | null = null;
  /** 为 true 时 flush 不执行出站/入站，用于断线期间暂停，重连后 resume 恢复 */
  private _isPaused = false;

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---------- 启动 / 停止 / 暂停 ----------
  /**
   * 启动队列：注册出站/入站/失败回调，并启动按 flushInterval 执行的 flush 定时器。
   * 每次 flush 先 flushIncoming 再 flushOutgoing；若 _isPaused 为 true 则本次不执行。
   * @param onFlushOutgoing 每批待发消息发送到 WS，返回 Promise，抛错则本批回队重试
   * @param onFlushIncoming 每批入站消息交给 UI/Store
   * @param onMessageSendFailed 可选，某条消息重试次数用尽时调用（用于派发 MESSAGE_SEND_FAILED）
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
   * 立即执行一次出站 flush（不等 flushInterval 定时器）。用于需要尽快发送的场景（如压测）；若已 pause 或 outgoing 为空则无操作。
   */
  async forceFlushOutgoing(): Promise<void> {
    if (!this._isPaused && this.outgoing.length > 0) {
      await this.flushOutgoing();
    }
  }

  /**
   * 停止队列：清除 flush 定时器与所有 ACK 超时定时器；不再 flush，但队列数据不清空。
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
   * 暂停队列：将 _isPaused 置 true，后续定时 flush 不再执行，直到 resume()。断线时由 IMClient 调用。
   */
  pause(): void {
    this._isPaused = true;
  }

  /**
   * 恢复队列：将 _isPaused 置 false，定时 flush 继续执行。重连成功后由 IMClient 调用。
   */
  resume(): void {
    this._isPaused = false;
  }

  // ---------- 入队 ----------
  /**
   * 将待发消息入队。若队列已达 maxSize，则尝试丢弃最旧的一条 status 非 SENDING 的消息以腾出空间；
   * 若全部为 SENDING（理论上少见）则拒绝入队并返回 false。
   */
  enqueueOutgoing(message: Message): boolean {
    if (this.outgoing.length >= this.config.maxSize) {
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
   * 将入站消息入队。若 message.id 已在 seenIds 中（ deduplicationWindow 内见过）则视为重复，丢弃并返回 false；
   * 否则写入 seenIds、push 到 incoming，并调用 cleanupDedup 清理超窗的 seenIds 条目。
   */
  enqueueIncoming(message: Message): boolean {
    if (this.isDuplicate(message.id)) {
      return false;
    }
    this.seenIds.set(message.id, Date.now());
    this.incoming.push(message);
    this.cleanupDedup();
    return true;
  }

  // ---------- 批量 flush（先入站再出站）----------
  /** 每次定时触发：先处理入站（交给 onFlushIncoming），再处理出站（交给 onFlushOutgoing） */
  private async flush(): Promise<void> {
    this.flushIncoming();
    await this.flushOutgoing();
  }

  /**
   * 从 incoming 取出最多 batchSize 条，一次性交给 onFlushIncoming；无回调或队列空则直接 return。
   */
  private flushIncoming(): void {
    if (this.incoming.length === 0 || !this.onFlushIncoming) return;
    const batch = this.incoming.splice(0, this.config.batchSize);
    this.onFlushIncoming(batch);
  }

  /**
   * 出站 flush：从 outgoing 取出最多 batchSize 条，attempts++ 后交给 onFlushOutgoing 发送。
   * 成功：每条移入 pendingAck 并设 ackTimeoutMs 定时器，超时未收到 onAck 则 handleAckTimeout 回队重发或 markSendFailed。
   * 失败（onFlushOutgoing 抛错）：本批每条若 attempts 未超 retryAttempts 则 unshift 回 outgoing，否则 markSendFailed。
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
      for (const pending of batch) {
        if (pending.attempts < this.config.retryAttempts) {
          this.outgoing.unshift(pending);
        } else {
          this.markSendFailed(pending);
        }
      }
    }
  }

  // ---------- ACK 确认与超时、断线回滚 ----------
  /**
   * 收到服务端对某条消息的 message_ack 时调用（IMClient 在收到 message_ack 帧时按 clientMsgId 调用）。
   * 从 pendingAck 与 ackTimers 中移除该条，不再等待 ACK 超时。
   */
  onAck(clientMsgId: string): void {
    const timer = this.ackTimers.get(clientMsgId);
    if (timer) {
      clearTimeout(timer);
      this.ackTimers.delete(clientMsgId);
    }
    this.pendingAck.delete(clientMsgId);
  }

  /**
   * ACK 超时回调（由 ackTimeoutMs 定时器触发）：该条消息发出后未在时限内收到 onAck，视为可能丢包。
   * 从 pendingAck 移除后，若 attempts < retryAttempts 则 unshift 回 outgoing 队头（下次 flush 再发），否则 markSendFailed。
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
   * 断线回滚（由 IMClient 在 DISCONNECTED 时调用）：将 pendingAck 中所有未确认消息移回 outgoing 队头，
   * 并清除对应的 ACK 超时定时器。每条若 attempts 已超 retryAttempts 则 markSendFailed，否则在重连后 resume 的后续 flush 中自动重发。
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

  /** 将消息状态置为 FAILED 并调用 onMessageSendFailed（若已注册），用于重试次数用尽或回滚时超限的情况 */
  private markSendFailed(pending: PendingMessage): void {
    console.error(
      `[MessageQueue] Message ${pending.message.id} failed after ${this.config.retryAttempts} attempts`,
    );
    pending.message.status = MessageStatus.FAILED;
    this.onMessageSendFailed?.(pending.message);
  }

  // ---------- 入站去重 ----------
  /** 判断入站消息 id 是否已在 seenIds 中（在 deduplicationWindow 内出现过则视为重复） */
  private isDuplicate(id: string): boolean {
    return this.seenIds.has(id);
  }

  /** 删除 seenIds 中时间戳早于 (now - deduplicationWindow) 的条目，避免缓存无限增长 */
  private cleanupDedup(): void {
    const cutoff = Date.now() - this.config.deduplicationWindow;
    for (const [id, ts] of this.seenIds) {
      if (ts < cutoff) {
        this.seenIds.delete(id);
      }
    }
  }

  // ---------- 统计与对外查询 ----------
  /**
   * 返回当前队列统计：outgoing 长度、pendingAck 数量、incoming 长度、seenIds 大小、是否暂停。用于调试或监控面板。
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

  /** 当前待发队列（outgoing）中的消息条数 */
  get pendingCount(): number {
    return this.outgoing.length;
  }
}
