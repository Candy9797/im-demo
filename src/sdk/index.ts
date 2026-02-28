/**
 * IM SDK 对外导出
 *
 * 统一导出 TIM、IMClient、WebSocketManager、MessageQueue、EventEmitter
 * 以及类型、常量等，供外部引用。
 */

// TIM 封装（统一 IM API 层）
export { TIM } from "./TIM";
export type {
  TIMOptions,
  LoginOptions,
  TIMConversation,
  GetMessageListOptions,
  GetMessageListResult,
  GetConversationListResult,
  TextMessagePayload,
  ImageMessagePayload,
  TIMMessage,
} from "./TIM";
export { TIM_EVENT, LOG_LEVEL } from "./TIM";

// IMClient 核心客户端
export { IMClient, createIMClient, DEFAULT_FAQ_ITEMS } from "./IMClient";

// 底层模块（高级用法）
export { WebSocketManager } from "./WebSocketManager";
export { MessageQueue } from "./MessageQueue";
export { EventEmitter } from "./EventEmitter";

// 类型与常量
export {
  MessageType,
  MessageStatus,
  SenderType,
  ConnectionState,
  ConversationPhase,
  SDKEvent,
  FrameType,
} from "./types";
export type {
  Message,
  MessageMetadata,
  QuoteInfo,
  TradeCardPayload,
  ConnectionConfig,
  SerializeFormat,
  AgentInfo,
  Conversation,
  FAQItem,
  Frame,
  QuickAction,
} from "./types";
