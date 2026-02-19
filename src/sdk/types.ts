/**
 * IM SDK 类型定义
 *
 * 消息、连接、会话、事件、协议帧等核心类型
 */

// ============ 消息相关 ============

/** 消息内容类型 */
export const MessageType = {
  TEXT: "text",           // 文本
  IMAGE: "image",         // 图片
  PDF: "pdf",             // PDF 文件
  EMOJI: "emoji",         // 表情
  SYSTEM: "system",       // 系统消息（如会话开始、转人工提示等）
  QUEUE_UPDATE: "queue",  // 排队状态更新
  AGENT_ASSIGN: "agent_assign",  // 分配客服通知
  STICKER: "sticker",     // 贴纸
  VOICE: "voice",         // 语音
  VIDEO: "video",         // 视频
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** 消息送达状态（单向递进，失败可重试） */
export const MessageStatus = {
  SENDING: "sending",     // 发送中（客户端已发出，等待 ACK）
  SENT: "sent",           // 已发送（服务端已确认）
  DELIVERED: "delivered", // 已送达（对方已收到）
  READ: "read",           // 已读
  FAILED: "failed",       // 发送失败（超时/网络错误等）
} as const;
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

/** 消息发送者类型 */
export const SenderType = {
  USER: "user",     // 当前用户
  BOT: "bot",       // 智能客服 Bot
  AGENT: "agent",   // 人工客服
  SYSTEM: "system", // 系统（排队、转接等提示）
} as const;
export type SenderType = (typeof SenderType)[keyof typeof SenderType];

/** 单条消息结构 */
export interface Message {
  id: string;                  // 消息 ID（服务端分配或 clientMsgId）
  conversationId: string;      // 所属会话 ID
  content: string;             // 文本内容或 URL（图片/文件等）
  type: MessageType;           // 消息类型
  status: MessageStatus;       // 送达状态
  senderType: SenderType;      // 发送者类型
  senderId: string;            // 发送者 userId
  senderName: string;          // 显示名称
  senderAvatar?: string;       // 头像 URL
  timestamp: number;           // 时间戳（毫秒）
  metadata?: MessageMetadata;  // 扩展元数据（引用、已读、反应等）
  seqId?: number;              // 服务端序号，用于排序和增量同步
}

/** 引用信息：回复某条消息时附带 */
export interface QuoteInfo {
  messageId: string;
  senderName: string;
  content: string;
  type: MessageType;
  timestamp: number;
}

/** 消息元数据（引用、已读、表情反应等） */
export interface MessageMetadata {
  reactions?: Record<string, string[]>;  // emoji -> userId[]，谁点了哪个表情
  mentions?: string[];                   // @提及的 userIds
  readBy?: string[];                     // 已读该消息的 userIds
  quote?: QuoteInfo;                     // 引用回复的目标消息
  [key: string]: unknown;
}

// ============ 连接配置 ============

/** WebSocket 连接状态 */
export const ConnectionState = {
  DISCONNECTED: "disconnected",  // 未连接
  CONNECTING: "connecting",      // 连接中（首次或重连中）
  CONNECTED: "connected",        // 已连接
  RECONNECTING: "reconnecting",  // 断线重连中
} as const;
export type ConnectionState =
  (typeof ConnectionState)[keyof typeof ConnectionState];

/** WebSocket 序列化格式：json 默认兼容性好，protobuf 高 QPS 场景更快更小 */
export type SerializeFormat = "json" | "protobuf";

/** WebSocket / HTTP 连接配置 */
export interface ConnectionConfig {
  url: string;                          // WebSocket URL（含 ?token=xxx）
  token?: string;                       // JWT，用于认证
  userId: string;                       // 当前用户 ID
  reconnectAttempts?: number;           // 重连最大次数，默认 5
  reconnectInterval?: number;           // 重连间隔基数（毫秒），指数退避
  heartbeatInterval?: number;           // 心跳 Ping 间隔（毫秒），默认 30000
  messageQueueSize?: number;            // 待发消息队列最大长度
  apiBaseUrl?: string;                  // HTTP API 根地址（上传、搜索等）
  fresh?: boolean;                      // 是否新建会话（不恢复历史）
  /** ACK 超时（毫秒），超时未收到 ACK 则重发，默认 10000 */
  ackTimeoutMs?: number;
  /** 从 persist 读取离线消息，auth_ok 服务端空消息时使用 */
  getPersistedMessages?: (conversationId: string) => Promise<Message[]>;
  /** 序列化格式：json | protobuf，默认 json；protobuf 适合高 QPS（快约 10 倍，体积小约 60%） */
  format?: SerializeFormat;
}

// ============ 会话相关 ============

/** 会话阶段（Bot → 排队 → Agent → 结束） */
export const ConversationPhase = {
  BOT: "bot",       // 智能客服阶段，FAQ + 关键词回复
  QUEUING: "queuing",  // 排队等待人工
  AGENT: "agent",   // 已分配人工客服
  CLOSED: "closed", // 会话已结束
} as const;
export type ConversationPhase =
  (typeof ConversationPhase)[keyof typeof ConversationPhase];

/** 人工客服信息（转人工后下发） */
export interface AgentInfo {
  id: string;
  name: string;
  code: string;       // 工号
  avatar?: string;
  department?: string;
}

/** 会话（单会话模式：Bot 或 Agent） */
export interface Conversation {
  id: string;
  phase: ConversationPhase;
  agentInfo?: AgentInfo;   // Agent 阶段有值
  queuePosition?: number;  // 排队中的位置
  queueTotal?: number;     // 排队总人数
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

/** 在线状态（用于 presence 展示） */
export interface PresenceInfo {
  userId: string;
  online: boolean;
  lastSeen?: number;       // 最后在线时间
}

// ============ SDK 事件 ============
/** IMClient 对外派发的事件，Store / UI 订阅后更新状态 */
export const SDKEvent = {
  // 连接
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  RECONNECTING: "reconnecting",
  CONNECTION_ERROR: "connection_error",
  // 消息
  MESSAGE_RECEIVED: "message_received",        // 收到单条消息
  MESSAGE_BATCH_RECEIVED: "message_batch_received",  // 收到批量消息（sync/history）
  MESSAGE_SENT: "message_sent",                // 本地发出的消息（乐观更新）
  MESSAGE_STATUS_UPDATE: "message_status_update",    // 消息状态变更（sent/delivered/read）
  MESSAGE_SEND_FAILED: "message_send_failed",  // 发送失败
  // 会话阶段
  PHASE_CHANGED: "phase_changed",   // 阶段变化（bot/queuing/agent/closed）
  AGENT_ASSIGNED: "agent_assigned", // 分配了人工客服
  QUEUE_UPDATE: "queue_update",     // 排队位置更新
  // 输入状态
  TYPING_START: "typing_start",
  TYPING_STOP: "typing_stop",
  // 会话重置（新建会话时清空消息）
  MESSAGES_RESET: "messages_reset",
  // 在线 / 已读 / 反应 / 编辑 / 撤回
  PRESENCE_UPDATE: "presence_update",
  READ_RECEIPT: "read_receipt",
  REACTION_UPDATE: "reaction_update",
  MESSAGE_EDIT: "message_edit",
  MESSAGE_RECALL: "message_recall",
  // 被踢下线（同账号多地登录）
  KICKED: "kicked",
  // 历史分页拉取
  HISTORY_LOADED: "history_loaded",
} as const;
export type SDKEvent = (typeof SDKEvent)[keyof typeof SDKEvent];

// ============ WebSocket 帧协议 ============
/** WebSocket 帧类型，用于 C2S / S2C 通信 */
export const FrameType = {
  // ---------- Client -> Server ----------
  AUTH: "auth",                  // 认证（实际通过 URL ?token= 传递，此类型备用）
  SEND_MESSAGE: "send_message",  // 发送消息；payload 支持 Message | Message[]（批量为数组）
  TYPING: "typing",              // 正在输入
  ACK: "ack",                    // 消息确认（收到消息后回 ACK）
  HEARTBEAT_PING: "ping",        // 心跳 Ping（默认 30s 一次）
  REQUEST_AGENT: "request_agent",  // 请求转人工
  SYNC: "sync",                  // 同步会话（拉取 afterSeqId 之后的消息）
  LOAD_HISTORY: "load_history",  // 拉取历史（beforeSeqId 之前的消息）
  MARK_READ: "mark_read",        // 标记消息已读
  ADD_REACTION: "add_reaction",  // 添加表情反应
  REMOVE_REACTION: "remove_reaction",  // 移除表情反应
  EDIT_MESSAGE: "edit_message",  // 编辑消息：payload { messageId, content }
  RECALL_MESSAGE: "recall_message",  // 撤回消息：payload { messageId }
  SIMULATE_PUSH: "simulate_push",  // 测试用：请求服务端推送 N 条 Mock 消息
  // ---------- Server -> Client ----------
  AUTH_OK: "auth_ok",            // 认证成功，附带 conversationId、消息等
  MESSAGE: "message",            // 收到消息（单条或批量）
  MESSAGE_ACK: "message_ack",    // 消息送达确认（含 serverMsgId、seqId）
  TYPING_START: "typing_start",  // 对方开始输入
  TYPING_STOP: "typing_stop",    // 对方停止输入
  HEARTBEAT_PONG: "pong",        // 心跳 Pong
  QUEUE_STATUS: "queue_status",  // 排队状态（position、total、estimatedWait）
  AGENT_INFO: "agent_info",      // 分配的人工客服信息
  PHASE_CHANGE: "phase_change",  // 会话阶段变更
  ERROR: "error",                // 错误（含 code、message）
  SYNC_RESPONSE: "sync_response",  // 同步结果（消息列表）
  SESSION_SWITCHED: "session_switched",  // 会话切换（多会话场景）
  HISTORY_RESPONSE: "history_response",  // 历史消息结果
  PRESENCE_UPDATE: "presence_update",    // 在线用户列表
  READ_RECEIPT: "read_receipt",  // 已读回执（messageIds、readBy）
  REACTION_UPDATE: "reaction_update",    // 表情反应更新
  MESSAGE_EDIT: "message_edit",  // 消息编辑回执（messageId、content）
  MESSAGE_RECALL: "message_recall",  // 消息撤回回执（messageId）
  KICKED: "kicked",              // 被踢下线（同账号多地登录）
} as const;
export type FrameType = (typeof FrameType)[keyof typeof FrameType];

/** WebSocket 帧结构：所有 C2S / S2C 消息的统一格式 */
export interface Frame {
  type: FrameType;
  seq: number;       // 帧序列号，用于顺序与去重
  timestamp: number; // 时间戳（毫秒）
  payload: unknown;  // 业务负载，根据 type 解析
}

// ============ FAQ / Bot ============

/** Bot 阶段常见问题项（点击后自动发送 question，Bot 回复 answer） */
export interface FAQItem {
  id: string;
  question: string;
  answer: string;
  category?: string;
  icon?: string;
}

/** 快捷操作（FAQ、转人工、外链等） */
export interface QuickAction {
  id: string;
  label: string;
  icon?: string;
  action: "faq" | "transfer_agent" | "link";
  payload?: string;  // faq 时为 faqId，link 时为 URL
}
