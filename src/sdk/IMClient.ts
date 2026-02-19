/**
 * IMClient - IM SDK 核心客户端
 *
 * ## 职责
 * - 会话管理：单会话模式，Bot/排队/Agent 阶段
 * - 消息收发：乐观更新 + MessageQueue 批处理、ACK 匹配、重试
 * - sync/history：重连后增量同步、向上分页拉历史
 * - 文件上传：HTTP POST 到 /api/upload
 * - 事件派发：SDKEvent 供 Store/UI 订阅
 *
 * ## 依赖
 * - WebSocketManager：连接、心跳、重连、帧收发
 * - MessageQueue：出站批处理、ACK 超时重发、入站去重
 *
 * ## 持久化
 * 由 chatStore + Zustand persist 负责；auth_ok 空消息时通过 getPersistedMessages 注入离线恢复
 */
import { EventEmitter } from "./EventEmitter";
import { WebSocketManager } from "./WebSocketManager";
import { MessageQueue } from "./MessageQueue";
import {
  type AgentInfo,
  type ConnectionConfig,
  ConnectionState,
  type Conversation,
  ConversationPhase,
  type FAQItem,
  FrameType,
  type Message,
  MessageStatus,
  MessageType,
  SDKEvent,
  SenderType,
} from "./types";

/** 默认 FAQ 列表，连接前即可展示；faq-6 为「转人工」占位，selectFAQ 会特殊处理 */
export const DEFAULT_FAQ_ITEMS: FAQItem[] = [
  {
    id: "faq-1",
    question: "How to deposit crypto?",
    answer: "To deposit crypto, go to your Wallet → Deposit...",
    category: "Wallet",
    icon: "💰",
  },
  {
    id: "faq-2",
    question: "How to reset 2FA?",
    answer: "To reset 2FA, go to Security Settings...",
    category: "Security",
    icon: "🔐",
  },
  {
    id: "faq-3",
    question: "Why is my withdrawal pending?",
    answer: "Withdrawals may be pending due to...",
    category: "Wallet",
    icon: "⏳",
  },
  {
    id: "faq-4",
    question: "How to enable Futures trading?",
    answer: "To enable Futures trading...",
    category: "Trading",
    icon: "📈",
  },
  {
    id: "faq-5",
    question: "KYC verification failed, what to do?",
    answer: "If KYC verification failed...",
    category: "Account",
    icon: "🪪",
  },
  {
    id: "faq-6",
    question: "Transfer to human support",
    answer: "",
    category: "Support",
    icon: "👤",
  },
];

export class IMClient extends EventEmitter {
  private wsManager: WebSocketManager; // WebSocket 连接管理
  private messageQueue: MessageQueue; // 消息队列（批处理、ACK、重试）
  private conversation: Conversation; // 当前会话
  private userId: string;
  private token: string;
  private apiBaseUrl: string; // HTTP API 根地址（上传、搜索）
  private faqItems: FAQItem[] = DEFAULT_FAQ_ITEMS;
  private getPersistedMessages?: (conversationId: string) => Promise<Message[]>; // 离线恢复用

  constructor(config: ConnectionConfig) {
    super();
    this.userId = config.userId;
    this.token = config.token ?? "";
    this.apiBaseUrl =
      (config as ConnectionConfig & { apiBaseUrl?: string }).apiBaseUrl ||
      "http://localhost:3001";

    this.wsManager = new WebSocketManager(config);
    // 发送消息配置
    this.messageQueue = new MessageQueue({
      maxSize: config.messageQueueSize || 2000,
      batchSize: 300,
      flushInterval: 50,
      ackTimeoutMs: config.ackTimeoutMs ?? 10000,
    });

    this.conversation = {
      id: "",
      phase: ConversationPhase.BOT,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.getPersistedMessages = config.getPersistedMessages;

    this.setupEventListeners();
  }

  /**
   * 建立连接：WebSocket 连上后等待 auth_ok，再启动 messageQueue
   * 流程：connect() → wsManager.connect() → auth_ok → 同步会话/消息 → start messageQueue → resolve
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAuthOk = async (payload: unknown) => {
        const data = payload as {
          conversationId?: string;
          phase?: string;
          messages?: Message[];
        };
        this.conversation.id = data.conversationId ?? this.conversation.id;
        this.conversation.phase =
          (data.phase as ConversationPhase) ?? ConversationPhase.BOT;
        const serverMessages = (data.messages ?? []) as Message[];
        // 服务端有消息则用服务端，否则尝试从 persist 恢复
        if (serverMessages.length > 0) {
          this.conversation.messages = serverMessages;
          this.conversation.updatedAt = Date.now();
          if (serverMessages.length === 1) {
            this.emit(SDKEvent.MESSAGE_RECEIVED, serverMessages[0]);
          } else {
            this.emit(SDKEvent.MESSAGE_BATCH_RECEIVED, serverMessages);
          }
        } else {
          try {
            const local = await this.getPersistedMessages?.(
              this.conversation.id,
            );
            if (local?.length) {
              this.conversation.messages = local;
              if (local.length === 1) {
                this.emit(SDKEvent.MESSAGE_RECEIVED, local[0]);
              } else {
                this.emit(SDKEvent.MESSAGE_BATCH_RECEIVED, local);
              }
            }
          } catch (_e) {}
        }
        // 若无欢迎语则补一条默认欢迎
        const welcome = this.conversation.messages.some(
          (m) =>
            m.type === MessageType.SYSTEM && m.content?.includes("Welcome"),
        );
        if (!welcome) {
          const w: Message = {
            id: `msg-welcome-${Date.now()}`,
            conversationId: this.conversation.id,
            content: "Welcome to IM Demo Support! How can we help you today?",
            type: MessageType.SYSTEM,
            status: MessageStatus.DELIVERED,
            senderType: SenderType.SYSTEM,
            senderId: "system",
            senderName: "System",
            timestamp: Date.now(),
          };
          this.conversation.messages.unshift(w);
          this.emit(SDKEvent.MESSAGE_RECEIVED, w);
        }
        // 启动消息队列：出站/入站/失败回调
        this.messageQueue.start(
          async (msgs) => this.handleOutgoingBatch(msgs),
          (msgs) => this.handleIncomingBatch(msgs),
          (msg) => {
            const idx = this.conversation.messages.findIndex(
              (m) => m.id === msg.id,
            );
            if (idx !== -1)
              this.conversation.messages[idx].status = MessageStatus.FAILED;
            this.emit(SDKEvent.MESSAGE_SEND_FAILED, msg);
          },
        );
        resolve();
      };

      this.wsManager.once("auth_ok", onAuthOk);
      this.wsManager.once(SDKEvent.CONNECTED, () => {}); // 占位，避免未订阅警告
      this.wsManager.once(SDKEvent.CONNECTION_ERROR, (err) => reject(err));

      this.wsManager.connect();
    });
  }

  /** 断开连接：停止队列、断开 WebSocket */
  disconnect(): void {
    this.messageQueue.stop();
    this.wsManager.disconnect();
  }

  /**
   * 发送消息：创建消息、入队、乐观派发 MESSAGE_SENT
   */
  sendMessage(
    content: string,
    type: MessageType = MessageType.TEXT,
    metadata?: Record<string, unknown>,
  ): Message {
    const message = this.createMessage(content, type, metadata);
    this.conversation.messages.push(message);
    this.conversation.updatedAt = Date.now();
    this.messageQueue.enqueueOutgoing(message);
    this.emit(SDKEvent.MESSAGE_SENT, message);
    return message;
  }

  /**
   * 上传文件并发送消息
   * get()：获取当前 Zustand 状态，不触发订阅更新
client：登录成功后、auth_ok 阶段创建的 IMClient 实例
if (!client) return：未登录或未建立 IM 连接时直接返回，避免空指针
   *
   * ## 流程
   * IMClient.sendFile 的完整流程
区分消息类型
file.type.startsWith("image/") → MessageType.IMAGE
其余（包括 video、PDF）→ MessageType.PDF
上传文件
FormData 打包文件
fetch 到 {apiBaseUrl}/api/upload
Header 带上 Authorization: Bearer ${token}
成功返回 { url: string }
失败处理
创建一条 [Upload failed] 消息，status = FAILED
emit MESSAGE_SENT + MESSAGE_SEND_FAILED
聊天列表显示发送失败状态
成功处理
用返回的 URL 和元数据调用 createMessage
conversation.messages.push(message)（内存会话）
messageQueue.enqueueOutgoing(message)（进入 WebSocket 发送队列）
emit MESSAGE_SENT（乐观更新）
WebSocket 发送
MessageQueue 批量处理出队消息
调用 handleOutgoingBatch，通过 wsManager.send(FrameType.SEND_MESSAGE, msg) 发送给服务端

   * 1. 按 file.type 判定消息类型：image/* → IMAGE，其他（video、PDF 等）→ PDF
   * 2. FormData 打包，POST 到 {apiBaseUrl}/api/upload，Header 带 Bearer token
   * 3. 失败：创建失败消息、push 到 conversation、emit MESSAGE_SENT + MESSAGE_SEND_FAILED
   * 4. 成功：取返回的 { url }，createMessage(url, type, metadata)，入队 MessageQueue，emit MESSAGE_SENT
   * 5. MessageQueue 批量处理时通过 WebSocket SEND_MESSAGE 帧发给服务端
   *
   * ## 调用链
   * InputArea.handleFileSelect → chatStore.sendFile → IMClient.sendFile
   *
   * ## 类型说明
   * - image/*（jpeg、png、gif、webp）→ MessageType.IMAGE
   * - video/*、application/pdf → MessageType.PDF
   *
   * @param file 用户选择的 File 对象（InputArea 已做大小≤10MB、类型校验）
   * @returns 创建的消息（成功时为 URL 消息，失败时为 "[Upload failed]" 且 status=FAILED）
   */
  async sendFile(file: File): Promise<Message> {
    const isImage = file.type.startsWith("image/");
    const type = isImage ? MessageType.IMAGE : MessageType.PDF;

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`${this.apiBaseUrl}/api/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: formData,
    });
    if (!res.ok) {
      const errMsg = this.createMessage("[Upload failed]", type, {
        fileName: file.name,
      });
      errMsg.status = MessageStatus.FAILED;
      this.conversation.messages.push(errMsg);
      this.emit(SDKEvent.MESSAGE_SENT, errMsg);
      this.emit(SDKEvent.MESSAGE_SEND_FAILED, errMsg);
      return errMsg;
    }

    const { url } = (await res.json()) as { url: string };
    const message = this.createMessage(url, type, {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    });
    this.conversation.messages.push(message);
    this.conversation.updatedAt = Date.now();
    this.messageQueue.enqueueOutgoing(message);
    this.emit(SDKEvent.MESSAGE_SENT, message);
    return message;
  }

  /**
   * 选择 FAQ：faq-6 为转人工，其余发送 question 文本
   */
  selectFAQ(faqId: string): void {
    const faq = this.faqItems.find((f) => f.id === faqId);
    if (!faq) return;
    if (faq.id === "faq-6") {
      this.requestHumanAgent();
      return;
    }
    this.sendMessage(faq.question, MessageType.TEXT);
  }

  /**
   * 请求转人工：发送 REQUEST_AGENT 帧，并显示排队中系统消息
   */
  requestHumanAgent(): void {
    this.wsManager.send(FrameType.REQUEST_AGENT, {
      conversationId: this.conversation.id,
      userId: this.userId,
    });
    const sysMsg = this.createSystemMessage(
      "Connecting you to a customer service representative...",
    );
    this.conversation.messages.push(sysMsg);
    this.emit(SDKEvent.MESSAGE_RECEIVED, sysMsg);
    this.setPhase(ConversationPhase.QUEUING);
  }

  /** 获取 FAQ 列表 */
  getFAQItems(): FAQItem[] {
    return this.faqItems;
  }

  /** 获取当前会话 */
  getConversation(): Conversation {
    return this.conversation;
  }

  /** 获取连接状态 */
  getConnectionState(): ConnectionState {
    return this.wsManager.getState();
  }

  /** 获取消息队列统计 */
  getQueueStats() {
    return this.messageQueue.getStats();
  }

  /** 立即 flush 出站队列（突发模式压测用，确保批量发送） */
  async forceFlushOutgoing(): Promise<void> {
    await this.messageQueue.forceFlushOutgoing();
  }

  /** 拉取 beforeSeqId 之前的历史消息 */
  loadHistory(beforeSeqId: number): void {
    this.wsManager.send(FrameType.LOAD_HISTORY, { beforeSeqId });
  }

  /** 标记消息已读 */
  markAsRead(messageIds: string[]): void {
    if (messageIds.length === 0) return;
    this.wsManager.send(FrameType.MARK_READ, { messageIds });
  }

  /** 添加表情反应 */
  addReaction(messageId: string, emoji: string): void {
    this.wsManager.send(FrameType.ADD_REACTION, { messageId, emoji });
  }

  /** 移除表情反应 */
  removeReaction(messageId: string, emoji: string): void {
    this.wsManager.send(FrameType.REMOVE_REACTION, { messageId, emoji });
  }

  /** 编辑消息（仅文本，需服务端确认） */
  editMessage(messageId: string, content: string): void {
    if (!content?.trim()) return;
    this.wsManager.send(FrameType.EDIT_MESSAGE, {
      messageId,
      content: content.trim(),
    });
  }

  /** 撤回消息（2 分钟内有效，需服务端确认） */
  recallMessage(messageId: string): void {
    this.wsManager.send(FrameType.RECALL_MESSAGE, { messageId });
  }

  /** 请求服务端推送 N 条 Mock 消息（仅 WS 测试页用） */
  requestSimulatePush(count: number): void {
    this.wsManager.send(FrameType.SIMULATE_PUSH, { count });
  }

  /** 发送贴纸（以 sticker 类型文本消息发送） */
  sendSticker(stickerId: string): Message {
    return this.sendMessage(stickerId, MessageType.STICKER);
  }

  /** 搜索当前会话消息（调用 HTTP API） */
  async searchMessages(query: string): Promise<Message[]> {
    const res = await fetch(
      `${this.apiBaseUrl}/api/search?q=${encodeURIComponent(
        query,
      )}&convId=${encodeURIComponent(this.conversation.id)}`,
      {
        headers: { Authorization: `Bearer ${this.token}` },
      },
    );
    if (!res.ok) return [];
    const { messages } = await res.json();
    return (messages ?? []).map((m: Record<string, unknown>) => ({
      ...m,
      conversationId: this.conversation.id,
    }));
  }

  /**
   * 订阅 WebSocketManager 事件，转发为 SDKEvent 或更新 conversation
   * 各事件对应 WebSocket 帧类型，见 types.ts FrameType
   */
  private setupEventListeners(): void {
    this.wsManager.on("auth_ok", () => {}); // connect 内已用 once 处理

    /** server_error：服务端错误（如 rate_limit），转发供压测等场景使用 */
    this.wsManager.on("server_error", (payload: unknown) =>
      this.emit("server_error", payload),
    );

    /** message_ack：服务端确认收到消息；支持单条或批量（payload 为对象或数组） */
    this.wsManager.on("message_ack", (payload: unknown) => {
      const items = Array.isArray(payload) ? payload : [payload];
      if (items.length > 1) this.emit("message_ack_batch", items.length);
      for (const p of items) {
        const raw = (p as { clientMsgId?: string; client_msg_id?: string; serverMsgId?: string }) ?? {};
        const clientMsgId = raw.clientMsgId ?? raw.client_msg_id;
        const serverMsgId = raw.serverMsgId ?? (raw as { server_msg_id?: string }).server_msg_id;
        if (!clientMsgId) {
          if (process.env.NODE_ENV === "development") console.warn("[IMClient] message_ack item missing clientMsgId", p);
          continue;
        }
        if (process.env.NODE_ENV === "development") console.log("[IMClient] onAck", clientMsgId);
        this.messageQueue.onAck(clientMsgId);
        const idx = this.conversation.messages.findIndex(
          (m) => m.id === clientMsgId,
        );
        if (idx === -1) continue;
        const msg = this.conversation.messages[idx];
        const updated: Message = {
          ...msg,
          id: serverMsgId ?? msg.id,
          status: MessageStatus.SENT,
        };
        this.conversation.messages[idx] = updated;
        this.emit(SDKEvent.MESSAGE_STATUS_UPDATE, updated);
      }
    });

    /** frame_in：收到 MESSAGE 帧，payload 支持单条 Message 或批量 Message[]，入队后由 MessageQueue 批处理派发 */
    this.wsManager.on("frame_in", (frame: unknown) => {
      const f = frame as { payload?: Message | Message[] };
      const raw = f.payload;
      if (!raw) return;
      const items = Array.isArray(raw) ? raw : [raw];
      const ids = new Set(this.conversation.messages.map((m) => m.id));
      const newMsgs = items.filter((m) => !ids.has(m.id)).map((m) => ({ ...m, conversationId: this.conversation.id } as Message));
      if (newMsgs.length === 0) return;
      this.conversation.messages = [...this.conversation.messages, ...newMsgs].sort(
        (a, b) => (a.seqId ?? a.timestamp) - (b.seqId ?? b.timestamp),
      );
      this.conversation.updatedAt = Date.now();
      for (const msg of newMsgs) this.messageQueue.enqueueIncoming(msg);
      // 直接派发到 Store，避免因队列去重（seenIds）导致消息不展示
      if (newMsgs.length === 1) {
        this.emit(SDKEvent.MESSAGE_RECEIVED, newMsgs[0]);
      } else {
        this.emit(SDKEvent.MESSAGE_BATCH_RECEIVED, newMsgs);
      }
    });

    /** sync_response：重连后增量同步结果，合并去重、按 seqId 排序后派发 */
    this.wsManager.on("sync_response", (payload: unknown) => {
      const { messages } = (payload as { messages?: Message[] }) ?? {};
      if (!messages?.length) return;
      const newMsgs = messages
        .filter(
          (msg) => !this.conversation.messages.some((m) => m.id === msg.id),
        )
        .map((m) => ({ ...m, conversationId: this.conversation.id }));
      if (newMsgs.length === 0) return;
      this.conversation.messages.push(...newMsgs);
      this.conversation.messages.sort(
        (a, b) => (a.seqId ?? a.timestamp) - (b.seqId ?? b.timestamp),
      );
      this.conversation.updatedAt = Date.now();
      if (newMsgs.length === 1) {
        this.emit(SDKEvent.MESSAGE_RECEIVED, newMsgs[0]);
      } else {
        this.emit(SDKEvent.MESSAGE_BATCH_RECEIVED, newMsgs);
      }
    });

    /** queue_update：转人工排队中的位置、总数、预估等待时间 */
    this.wsManager.on("queue_update", (payload: unknown) => {
      const data = payload as {
        position?: number;
        total?: number;
        estimatedWait?: number;
      };
      this.conversation.queuePosition = data.position ?? 0;
      this.conversation.queueTotal = data.total ?? 0;
      this.emit(SDKEvent.QUEUE_UPDATE, data);
    });

    /** agent_assigned：分配了人工客服，更新 agentInfo、阶段为 AGENT */
    this.wsManager.on("agent_assigned", (payload: unknown) => {
      const agent = payload as AgentInfo;
      this.conversation.agentInfo = agent;
      this.conversation.queuePosition = 0;
      this.setPhase(ConversationPhase.AGENT);
      this.emit(SDKEvent.AGENT_ASSIGNED, agent);
    });

    /** phase_change：会话阶段变更（bot/queuing/agent/closed） */
    this.wsManager.on("phase_change", (payload: unknown) => {
      const data = payload as {
        phase?: ConversationPhase;
        agentInfo?: AgentInfo;
      };
      if (data.phase) this.setPhase(data.phase);
      if (data.agentInfo) this.conversation.agentInfo = data.agentInfo;
    });

    /** session_switched：多会话场景下切换会话，重置 conversation */
    this.wsManager.on("session_switched", async (payload: unknown) => {
      const data = payload as {
        conversationId?: string;
        sessionType?: string;
        phase?: ConversationPhase;
        agentInfo?: AgentInfo;
        messages?: Message[];
      };
      if (!data.conversationId) return;
      this.conversation.id = data.conversationId;
      this.conversation.phase =
        (data.phase as ConversationPhase) ?? ConversationPhase.AGENT;
      this.conversation.agentInfo = data.agentInfo ?? undefined;
      this.conversation.messages = (data.messages ?? []) as Message[];
      this.conversation.updatedAt = Date.now();
      this.emit(SDKEvent.AGENT_ASSIGNED, data.agentInfo);
      this.emit(SDKEvent.PHASE_CHANGED, this.conversation.phase);
      this.emit(SDKEvent.MESSAGES_RESET, {
        messages: this.conversation.messages,
        conversationId: this.conversation.id,
      });
    });

    /** CONNECTED：恢复 messageQueue，若有会话则发送 SYNC 补拉离线期间消息 */
    this.wsManager.on(SDKEvent.CONNECTED, () => {
      this.messageQueue.resume();
      this.emit(SDKEvent.CONNECTED);
      // 增量离线同步：重连后若有 conversationId，发送 SYNC 补拉 afterSeqId 之后的消息
      if (this.conversation.id) {
        const withSeq = this.conversation.messages.filter(
          (m) => m.seqId != null,
        );
        const afterSeqId =
          withSeq.length > 0 ? Math.max(...withSeq.map((m) => m.seqId!)) : 0;
        this.wsManager.send(FrameType.SYNC, {
          afterSeqId,
          conversationId: this.conversation.id,
        });
      }
    });

    /** DISCONNECTED：回滚待确认消息到队列、暂停队列、派发断开事件 */
    this.wsManager.on(SDKEvent.DISCONNECTED, () => {
      this.messageQueue.rollbackPendingAck();
      this.messageQueue.pause();
      this.emit(SDKEvent.DISCONNECTED);
    });

    /** RECONNECTING：原样转发 */
    this.wsManager.on(SDKEvent.RECONNECTING, () =>
      this.emit(SDKEvent.RECONNECTING),
    );

    /** history_response：loadHistory 拉取结果，插入到消息列表头部，按 seqId 排序 */
    this.wsManager.on("history_response", (payload: unknown) => {
      const { messages, hasMore } = payload as {
        messages?: Message[];
        hasMore?: boolean;
      };
      if (!messages?.length) return;
      const newMsgs = messages.filter(
        (m) => !this.conversation.messages.some((x) => x.id === m.id),
      );
      if (newMsgs.length === 0) return;
      this.conversation.messages = [
        ...newMsgs,
        ...this.conversation.messages,
      ].sort((a, b) => (a.seqId ?? a.timestamp) - (b.seqId ?? b.timestamp));
      this.conversation.updatedAt = Date.now();
      this.emit(SDKEvent.HISTORY_LOADED, {
        messages: newMsgs,
        hasMore: !!hasMore,
      });
    });

    /** 以下事件原样转发给上层 */
    this.wsManager.on(SDKEvent.TYPING_START, (payload: unknown) =>
      this.emit(SDKEvent.TYPING_START, payload),
    );
    this.wsManager.on(SDKEvent.TYPING_STOP, (payload: unknown) =>
      this.emit(SDKEvent.TYPING_STOP, payload),
    );
    this.wsManager.on(SDKEvent.PRESENCE_UPDATE, (payload: unknown) =>
      this.emit(SDKEvent.PRESENCE_UPDATE, payload),
    );
    /** KICKED：被踢下线，先 disconnect 再派发 */
    this.wsManager.on(SDKEvent.KICKED, (payload: unknown) => {
      this.disconnect();
      this.emit(SDKEvent.KICKED, payload);
    });
    this.wsManager.on(SDKEvent.READ_RECEIPT, (payload: unknown) =>
      this.emit(SDKEvent.READ_RECEIPT, payload),
    );
    this.wsManager.on(SDKEvent.REACTION_UPDATE, (payload: unknown) =>
      this.emit(SDKEvent.REACTION_UPDATE, payload),
    );
    this.wsManager.on(SDKEvent.MESSAGE_EDIT, (payload: unknown) =>
      this.emit(SDKEvent.MESSAGE_EDIT, payload),
    );
    this.wsManager.on(SDKEvent.MESSAGE_RECALL, (payload: unknown) =>
      this.emit(SDKEvent.MESSAGE_RECALL, payload),
    );
  }

  /** 更新会话阶段并派发 PHASE_CHANGED */
  private setPhase(phase: ConversationPhase): void {
    this.conversation.phase = phase;
    this.emit(SDKEvent.PHASE_CHANGED, phase);
  }

  /** 创建用户消息：id 为 clientMsgId，status 为 SENDING，ACK 到达后更新为 SENT */
  private createMessage(
    content: string,
    type: MessageType,
    metadata?: Record<string, unknown>,
  ): Message {
    return {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId: this.conversation.id,
      content,
      type,
      status: MessageStatus.SENDING,
      senderType: SenderType.USER,
      senderId: this.userId,
      senderName: "You",
      timestamp: Date.now(),
      metadata,
    };
  }

  /** 创建系统消息（用于转人工、排队等提示） */
  private createSystemMessage(content: string): Message {
    return {
      id: `msg-${Date.now()}-sys`,
      conversationId: this.conversation.id,
      content,
      type: MessageType.SYSTEM,
      status: MessageStatus.DELIVERED,
      senderType: SenderType.SYSTEM,
      senderId: "system",
      senderName: "System",
      timestamp: Date.now(),
    };
  }

  /**
   * 出站批量发送：多条消息合并为一帧 SEND_MESSAGE（payload 为数组），减少 ws 帧数
   * 单条时仍发单对象，兼容服务端
   */
  private async handleOutgoingBatch(messages: Message[]): Promise<void> {
    if (messages.length === 0) return;
    if (messages.length === 1) {
      this.wsManager.send(FrameType.SEND_MESSAGE, messages[0]);
    } else {
      this.wsManager.send(FrameType.SEND_MESSAGE, messages);
    }
  }

  /** 入站批量处理：派发 MESSAGE_RECEIVED 或 MESSAGE_BATCH_RECEIVED */
  private handleIncomingBatch(messages: Message[]): void {
    if (messages.length === 0) return;
    if (messages.length === 1) {
      this.emit(SDKEvent.MESSAGE_RECEIVED, messages[0]);
    } else {
      this.emit(SDKEvent.MESSAGE_BATCH_RECEIVED, messages);
    }
  }
}

/**
 * 工厂函数：创建 IMClient 实例，自动补全 url、apiBaseUrl 等默认配置
 * 浏览器环境用 window.location.hostname:3001，SSR 用 localhost:3001
 */
export function createIMClient(
  config: ConnectionConfig & { url?: string; apiBaseUrl?: string },
): IMClient {
  const wsUrl =
    config.url ||
    (typeof window !== "undefined"
      ? `ws://${window.location.hostname}:3001/ws`
      : "ws://localhost:3001/ws");
  return new IMClient({
    ...config,
    url: wsUrl,
    userId: config.userId,
    token: config.token ?? "",
    apiBaseUrl:
      config.apiBaseUrl ||
      (typeof window !== "undefined"
        ? `${window.location.protocol}//${window.location.hostname}:3001`
        : "http://localhost:3001"),
    reconnectAttempts: config.reconnectAttempts ?? 5,
    reconnectInterval: config.reconnectInterval ?? 1000,
    heartbeatInterval: config.heartbeatInterval ?? 30000,
    messageQueueSize: config.messageQueueSize ?? 1000,
    fresh: config.fresh,
    format: config.format ?? "json",
    getPersistedMessages: config.getPersistedMessages,
  } as ConnectionConfig & { apiBaseUrl: string });
}
