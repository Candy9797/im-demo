/**
 * EventEmitter - IM SDK 事件系统
 *
 * 职责：发布/订阅模式，解耦 SDK 内部与 UI 层
 * 能力：普通订阅 on、单次订阅 once、取消订阅 off、批量移除 removeAllListeners
 *
 * ## 使用场景
 *
 * **on（持久订阅）**：每次 emit 都会触发，适合持续监听
 * - 例如：连接状态变化、收到消息、消息状态更新、会话阶段变更
 * - 典型用法：Store 订阅 IMClient 的 SDKEvent，更新 UI 状态
 *
 * **once（单次订阅）**：触发一次后自动移除，适合一次性逻辑
 * - 例如：connect() 的 Promise resolve（auth_ok 只等一次）、初始化完成回调
 * - 典型用法：await new Promise((resolve) => client.once('connected', resolve))
 *
 * 派发顺序：先触发 on 订阅，再触发 once 订阅。持久监听者先处理，一次性逻辑后执行。
 */

/** 事件回调函数类型 */
type EventCallback = (...args: unknown[]) => void;

export class EventEmitter {
  /** 持久订阅：每次 emit 都会触发 */
  private listeners: Map<string, Set<EventCallback>> = new Map();
  /** 单次订阅：触发一次后自动移除 */
  private onceListeners: Map<string, Set<EventCallback>> = new Map();

  /**
   * 订阅事件，返回取消订阅函数
   */
  on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function for easy cleanup
    return () => this.off(event, callback);
  }

  /**
   * 单次订阅：触发一次后自动移除
   */
  once(event: string, callback: EventCallback): () => void {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, new Set());
    }
    this.onceListeners.get(event)!.add(callback);

    return () => {
      this.onceListeners.get(event)?.delete(callback);
    };
  }

  /**
   * 取消订阅（从 on 和 once 中移除）
   */
  off(event: string, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback);
    this.onceListeners.get(event)?.delete(callback);
  }

  /**
   * 派发事件：先触发 on 订阅，再触发 once 订阅（once 触发后移除）
   */
  emit(event: string, ...args: unknown[]): void {
    // 持久订阅
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(...args);
      } catch (err) {
        console.error(`[EventEmitter] Error in listener for "${event}":`, err);
      }
    });

    // 单次订阅：触发后清空
    const onceSet = this.onceListeners.get(event);
    if (onceSet) {
      onceSet.forEach((cb) => {
        try {
          cb(...args);
        } catch (err) {
          console.error(
            `[EventEmitter] Error in once listener for "${event}":`,
            err
          );
        }
      });
      onceSet.clear();
    }
  }

  /**
   * 移除所有监听：传入 event 则移除该事件，否则移除全部
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
      this.onceListeners.delete(event);
    } else {
      this.listeners.clear();
      this.onceListeners.clear();
    }
  }

  /**
   * 获取某事件的监听器数量
   */
  listenerCount(event: string): number {
    return (
      (this.listeners.get(event)?.size || 0) +
      (this.onceListeners.get(event)?.size || 0)
    );
  }
}
