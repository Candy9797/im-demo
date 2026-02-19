/**
 * TIM - 类 TIM 风格的 IM 封装层
 *
 * ## 做什么
 * 在 IMClient 之上提供一套统一的 IM API：create/login/getConversationList/
 * getMessageList/sendMessage 等，作为适配层对接不同 IM 后端。
 *
 * ## 为什么这样做
 * 1. **API 统一**：上层使用 TIM 的 create/login/sendMessage 等，与底层 IMClient 解耦
 * 2. **分层架构**：TIM 只做协议转换，核心逻辑在 IMClient，维护与扩展更清晰
 * 3. **适配器模式**：将来可替换底层为其他 IM 实现，上层业务代码基本不动
 *
 * ## 使用示例
 *   const tim = TIM.create({ sdkAppId: 0 });
 *   await tim.login({ userId: 'user1', userSig: 'token-xxx' });
 *   const { data } = await tim.getConversationList();
 *   tim.on(TIM.EVENT.MESSAGE_RECEIVED, (msg) => { ... });
 */

import { EventEmitter } from "./EventEmitter";
import { IMClient, createIMClient } from "./IMClient";
import type { Message, Conversation, AgentInfo } from "./types";
import {
  MessageType,
  MessageStatus,
  SenderType,
  SDKEvent,
  type ConnectionState,
  type ConversationPhase,
  type MessageMetadata,
} from "./types";

// ============ TIM 事件枚举 ============
/**
 * TIM 对外派发的事件
 * 为什么单独定义：与 IMClient 的 SDKEvent 解耦，上层只用 TIM_EVENT，不依赖底层事件名
 */
export const TIM_EVENT = {
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  RECONNECTING: "reconnecting",
  MESSAGE_RECEIVED: "message_received",
  MESSAGE_SENT: "message_sent",
  CONVERSATION_LIST_UPDATED: "conversation_list_updated",
  KICKED: "kicked",
  ERROR: "error",
} as const;
export type TIM_EVENT = (typeof TIM_EVENT)[keyof typeof TIM_EVENT];

// ============ TIM 日志级别 ============
/**
 * 日志级别：OFF=0, ERROR=1, WARN=2, INFO=3, DEBUG=4
 * 预留：当前未使用，后续可用于 SDK 内部调试输出控制
 */
export const LOG_LEVEL = {
  OFF: 0,
  ERROR: 1,
  WARN: 2,
  INFO: 3,
  DEBUG: 4,
} as const;

// ============ TIM 类型定义 ============
/**
 * TIM.create() 配置项
 * sdkAppId：预留，本实现未使用；wsUrl/apiBaseUrl 可覆盖默认地址
 */
export interface TIMOptions {
  sdkAppId?: number;
  wsUrl?: string;
  apiBaseUrl?: string;
  logLevel?: number;
}

/**
 * TIM.login() 参数
 * userSig 对应 IMClient 的 token（JWT），fresh 表示是否新建会话
 */
export interface LoginOptions {
  userId: string;
  userSig: string;
  fresh?: boolean;
}

/**
 * TIM 风格会话
 * 标准会话结构：conversationID、type(C2C/GROUP/SYSTEM)、unreadCount 等
 */
export interface TIMConversation {
  conversationID: string;
  type: "C2C" | "GROUP" | "SYSTEM";  // C2C=单聊(Agent阶段)，SYSTEM=Bot/排队
  unreadCount: number;
  lastMessage?: Message;
  agentInfo?: AgentInfo;
  phase?: ConversationPhase;
}

/**
 * 拉取消息列表参数
 * nextReqMessageID：分页游标，表示"从这个消息往前拉"；首次不传则拉最新 count 条
 */
export interface GetMessageListOptions {
  conversationID: string;
  count: number;
  nextReqMessageID?: string;
}

/**
 * 拉取消息列表返回
 * nextReqMessageID：下次分页请求的游标；isCompleted 表示是否已拉完
 */
export interface GetMessageListResult {
  data: {
    messageList: Message[];
    nextReqMessageID: string | null;
    isCompleted: boolean;
  };
}

/** 拉取会话列表返回 */
export interface GetConversationListResult {
  data: {
    conversationList: TIMConversation[];
  };
}

/** 文本消息 payload */
export interface TextMessagePayload {
  text: string;
}

/** 图片/文件消息 payload */
export interface ImageMessagePayload {
  file: File;
}

/**
 * TIM 风格消息
 * 标准消息结构：type + payload + metadata，方便上层统一处理
 */
export interface TIMMessage {
  type: "text" | "image" | "file" | "custom";
  payload: TextMessagePayload | ImageMessagePayload | Record<string, unknown>;
  conversationID?: string;
  metadata?: MessageMetadata;
}

// ============ TIM 类 ============
export class TIM extends EventEmitter {
  static LOG_LEVEL = LOG_LEVEL;
  static EVENT = TIM_EVENT;

  private options: Required<Pick<TIMOptions, "logLevel">> & TIMOptions;
  /** 底层 IMClient，login 后创建，logout 后置空 */
  private client: IMClient | null = null;
  private _userId = "";
  private _userSig = "";

  private constructor(options: TIMOptions = {}) {
    super();
    this.options = {
      sdkAppId: options.sdkAppId ?? 0,
      wsUrl: options.wsUrl,
      apiBaseUrl: options.apiBaseUrl,
      logLevel: options.logLevel ?? LOG_LEVEL.OFF,
    };
  }

  /**
   * 创建 TIM 实例
   * 为什么用静态方法：通过 TIM.create() 创建实例；可多次 create 得到多个独立实例
   */
  static create(options?: TIMOptions): TIM {
    return new TIM(options);
  }

  /**
   * 登录并建立连接
   * 流程：创建 IMClient → 转发事件 → connect。wsUrl/apiBaseUrl 未传时用当前 host + 3001 端口
   */
  async login(options: LoginOptions): Promise<void> {
    const { userId, userSig, fresh } = options;
    this._userId = userId;
    this._userSig = userSig;

    const wsUrl =
      this.options.wsUrl ||
      (typeof window !== "undefined"
        ? `ws://${window.location.hostname}:3001/ws`
        : "ws://localhost:3001/ws");
    const apiBaseUrl =
      this.options.apiBaseUrl ||
      (typeof window !== "undefined"
        ? `${window.location.protocol}//${window.location.hostname}:3001`
        : "http://localhost:3001");

    this.client = createIMClient({
      userId,
      token: userSig,
      url: wsUrl,
      apiBaseUrl,
      fresh: fresh ?? false,
    });

    this.forwardEvents();
    await this.client.connect();
  }

  /**
   * 登出：断开连接、移除 IMClient 监听、清空 client，防止内存泄漏
   */
  logout(): void {
    if (this.client) {
      this.client.disconnect();
      this.client.removeAllListeners();
      this.client = null;
    }
    this._userId = "";
    this._userSig = "";
  }

  /**
   * 获取会话列表
   * 本实现为单会话模式，故始终返回仅含当前会话的数组；多会话场景可扩展
   */
  async getConversationList(): Promise<GetConversationListResult> {
    const conv = this.getConversationOrThrow();
    const timConv = this.toTIMConversation(conv);
    return { data: { conversationList: [timConv] } };
  }

  /**
   * 获取消息列表（支持分页）
   * 分页逻辑：无 nextReqMessageID 时取最新 count 条；有则从该消息往前取 count 条
   * 为什么用 nextReqMessageID：游标分页，支持向上滚动加载更多历史
   */
  async getMessageList(
    options: GetMessageListOptions
  ): Promise<GetMessageListResult> {
    const { conversationID, count, nextReqMessageID } = options;
    const conv = this.getConversationOrThrow();
    if (conv.id !== conversationID) {
      return {
        data: { messageList: [], nextReqMessageID: null, isCompleted: true },
      };
    }

    const messages = conv.messages;
    let list: Message[];
    let nextReq: string | null = null;

    if (!nextReqMessageID) {
      list = messages.slice(-count);
      nextReq =
        messages.length > count
          ? messages[messages.length - count - 1]?.id ?? null
          : null;
    } else {
      const idx = messages.findIndex((m) => m.id === nextReqMessageID);
      if (idx <= 0) {
        return {
          data: { messageList: [], nextReqMessageID: null, isCompleted: true },
        };
      }
      const start = Math.max(0, idx - count);
      list = messages.slice(start, idx);
      nextReq = start > 0 ? messages[start - 1]?.id ?? null : null;
    }

    return {
      data: {
        messageList: list,
        nextReqMessageID: nextReq,
        isCompleted: nextReq === null,
      },
    };
  }

  /**
   * 发送消息
   * 根据 TIMMessage.type 分发：text→sendMessage，image/file→sendFile，custom→取 text 或 JSON 发文本
   */
  async sendMessage(
    message: TIMMessage
  ): Promise<{ data: { message: Message } }> {
    const client = this.getClientOrThrow();
    const conv = client.getConversation();

    let msg: Message;
    if (message.type === "text") {
      const payload = message.payload as TextMessagePayload;
      msg = client.sendMessage(
        payload.text,
        MessageType.TEXT,
        message.metadata
      );
    } else if (message.type === "image" || message.type === "file") {
      const payload = message.payload as ImageMessagePayload;
      msg = await client.sendFile(payload.file);
    } else {
      const payload = message.payload as Record<string, unknown>;
      const content = (payload.text as string) ?? JSON.stringify(payload);
      msg = client.sendMessage(content, MessageType.TEXT, message.metadata);
    }

    return { data: { message: msg } };
  }

  /**
   * 创建文本消息（供 sendMessage 使用）
   * 返回 TIMMessage 对象，上层可先 create 再 send
   */
  createTextMessage(
    payload: TextMessagePayload,
    metadata?: MessageMetadata
  ): TIMMessage {
    return { type: "text", payload, metadata };
  }

  /**
   * 创建图片/文件消息（payload 含 File，sendMessage 会调用 sendFile 上传）
   */
  createImageMessage(
    payload: ImageMessagePayload,
    metadata?: MessageMetadata
  ): TIMMessage {
    return { type: "image", payload, metadata };
  }

  /**
   * 创建自定义消息（payload 为任意对象，发送时转为文本或 JSON）
   */
  createCustomMessage(
    payload: Record<string, unknown>,
    metadata?: MessageMetadata
  ): TIMMessage {
    return { type: "custom", payload, metadata };
  }

  /**
   * 获取当前会话
   */
  getCurrentConversation(): Conversation | null {
    return this.client?.getConversation() ?? null;
  }

  /**
   * 获取连接状态
   */
  getConnectionState(): ConnectionState {
    return (
      this.client?.getConnectionState() ?? ("disconnected" as ConnectionState)
    );
  }

  /**
   * 事件订阅：继承 EventEmitter，使用 tim.on(TIM.EVENT.XXX, callback) 订阅
   */

  /**
   * 设置日志级别（预留，当前未使用）
   */
  setLogLevel(level: number): void {
    this.options.logLevel = level;
  }

  /**
   * 获取底层 IMClient
   * 为什么暴露：TIM 只封装常用 API，requestAgent、loadHistory 等高级能力需直接调 IMClient
   */
  getIMClient(): IMClient | null {
    return this.client;
  }

  /**
   * 加载更早的历史消息（向上分页）
   * beforeSeqId 之前的消息通过 WebSocket 拉取，结果通过 HISTORY_LOADED 事件下发
   */
  loadHistory(beforeSeqId: number): void {
    this.getClientOrThrow().loadHistory(beforeSeqId);
  }

  /**
   * 标记消息已读（发送 MARK_READ 帧，服务端会下发达成的已读回执）
   */
  markAsRead(messageIds: string[]): void {
    this.client?.markAsRead(messageIds);
  }

  /**
   * 添加表情反应（如 👍），服务端会广播 REACTION_UPDATE
   */
  addReaction(messageId: string, emoji: string): void {
    this.client?.addReaction(messageId, emoji);
  }

  /**
   * 移除表情反应
   */
  removeReaction(messageId: string, emoji: string): void {
    this.client?.removeReaction(messageId, emoji);
  }

  /**
   * 转人工客服：发送 REQUEST_AGENT 帧，进入排队，分配后进入 Agent 阶段
   */
  requestHumanAgent(): void {
    this.getClientOrThrow().requestHumanAgent();
  }

  /**
   * 搜索当前会话消息（调用 HTTP /api/search，服务端全文检索）
   */
  async searchMessages(query: string): Promise<Message[]> {
    return this.getClientOrThrow().searchMessages(query);
  }

  // ============ 内部方法 ============
  /** 获取 IMClient；未登录时抛错，避免 NPE 和模糊错误 */
  private getClientOrThrow(): IMClient {
    if (!this.client)
      throw new Error("TIM: Not logged in. Call login() first.");
    return this.client;
  }

  /** 获取当前会话（connect 成功后必有）；无会话时抛错 */
  private getConversationOrThrow() {
    const conv = this.client?.getConversation();
    if (!conv) throw new Error("TIM: No active conversation.");
    return conv;
  }

  /**
   * 将内部 Conversation 转为 TIM 风格的 TIMConversation
   * type：Agent 阶段为 C2C，Bot/排队为 SYSTEM；unreadCount 排除 USER/SYSTEM 且非已读的消息
   */
  private toTIMConversation(conv: Conversation): TIMConversation {
    const lastMsg = conv.messages[conv.messages.length - 1];
    const unreadCount = conv.messages.filter(
      (m) =>
        m.senderType !== SenderType.USER &&
        m.senderType !== SenderType.SYSTEM &&
        m.status !== MessageStatus.READ
    ).length;

    return {
      conversationID: conv.id,
      type: conv.phase === "agent" ? "C2C" : "SYSTEM",
      unreadCount,
      lastMessage: lastMsg,
      agentInfo: conv.agentInfo,
      phase: conv.phase,
    };
  }

  /**
   * 将 IMClient 的 SDKEvent 转发为 TIM_EVENT
   * 为什么：上层只订阅 TIM_EVENT，不感知 IMClient；CONVERSATION_LIST_UPDATED 在收/发消息时触发，保持会话列表"最新"的语义
   */
  private forwardEvents(): void {
    if (!this.client) return;
    const c = this.client;
    c.on(SDKEvent.CONNECTED, () => this.emit(TIM_EVENT.CONNECTED));
    c.on(SDKEvent.DISCONNECTED, () => this.emit(TIM_EVENT.DISCONNECTED));
    c.on(SDKEvent.RECONNECTING, () => this.emit(TIM_EVENT.RECONNECTING));
    c.on(SDKEvent.MESSAGE_RECEIVED, (msg: unknown) =>
      this.emit(TIM_EVENT.MESSAGE_RECEIVED, msg)
    );
    c.on(SDKEvent.MESSAGE_SENT, (msg: unknown) =>
      this.emit(TIM_EVENT.MESSAGE_SENT, msg)
    );
    c.on(SDKEvent.KICKED, (payload: unknown) =>
      this.emit(TIM_EVENT.KICKED, payload)
    );
    c.on(SDKEvent.MESSAGE_RECEIVED, () =>
      this.emit(TIM_EVENT.CONVERSATION_LIST_UPDATED, {})
    );
    c.on(SDKEvent.MESSAGE_SENT, () =>
      this.emit(TIM_EVENT.CONVERSATION_LIST_UPDATED, {})
    );
  }
}
