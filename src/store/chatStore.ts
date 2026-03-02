"use client";

/**
 * chatStore - 客服 IM 聊天状态（Bot + 转人工 Agent）
 *
 * ## 为何与 chatSessionStore 分开？
 * - 业务域不同：本 store 是「客服对话」场景，WebSocket 长连接、服务端同步、Bot/Agent 双会话
 * - chatSessionStore 是「好友/群组」场景，Mock 数据、多会话切换、无服务端
 * - 分开后：路由 / 与 /chat-session 互不影响，组件按需引入各自 store，避免无关状态变化触发重渲染
 *
 * ## 架构
 * - Zustand + Immer：create(immer((set, get) => ...))，set 内可写式更新（draft）
 * - 事件驱动：IMClient 触发 SDKEvent，Store 订阅后 set 更新，UI 自动重渲染
 * - 数据流：UI 调用 action → action 调 IMClient / set 更新 → 订阅该 state 的组件重绘
 * - 引用隔离：push 消息时用 { ...m } 拷贝，因 Immer 会 freeze 新 state，不能与 IMClient 共享引用
 *
 * ## 状态划分说明
 * | 分类 | 字段 | 为何单独一组 | 触发更新的来源 |
 * |------|------|--------------|----------------|
 * | 认证 | auth, authError | 登录是前置条件，未登录时 client/initialize 不执行 | connectWallet、connectAsGuest、KICKED |
 * | 连接 | connectionState, client | 连接层与业务解耦，组件据此显示「连接中/已断开」 | CONNECTED、DISCONNECTED、RECONNECTING |
 * | 会话 | phase, agentInfo, queue, messages | 单会话模型，当前只与一个 Bot/Agent 对话 | MESSAGE_*、PHASE_CHANGED、AGENT_ASSIGNED、QUEUE_UPDATE |
 * | 会话辅助 | hasMoreHistory, loadingHistory | 历史分页，避免与主消息流混在一起 | HISTORY_LOADED、loadMoreHistory |
 * | 会话辅助 | typing | 输入中状态，独立于消息列表 | TYPING_START、TYPING_STOP |
 * | 会话辅助 | onlineUsers | 在线人数，Header 展示 | PRESENCE_UPDATE |
 * | UI | isOpen, isMinimized | 弹窗控制，Landing/ChatWidget 用 | toggleOpen、toggleMinimize |
 * | UI | quoteTarget, scrollToInputRequest | 引用回复 + 滚动信号，InputArea 监听 | replyToMessage、sendMessage |
 * | UI | showWalletModal, searchResults | 弹窗、搜索结果，按需展示 | setShowWalletModal、searchMessages、clearSearch |
 *
 * ## 状态与 UI 映射
 * 详见 docs/chatStore状态与UI映射.md
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import {
  IMClient,
  type Message,
  type TradeCardPayload,
  ConversationPhase,
  type AgentInfo,
  ConnectionState,
  SDKEvent,
  MessageType,
  MessageStatus,
  SenderType,
  type FAQItem,
  type SerializeFormat,
  createIMClient,
  DEFAULT_FAQ_ITEMS,
} from "@/sdk";
import { signInWithWallet } from "@/lib/siwe";
import {
  chatPersistStorage,
  CHAT_PERSIST_NAME,
  getPersistedChatState,
  normalizePersistedMessages,
} from "@/lib/chatPersistStorage";

/** 撤回失败时用于回滚乐观更新（recall_expired） */
let _pendingRecallRevert: { messageId: string; content: string } | null = null;

const CHAT_WINDOW_OPEN_KEY = "im-chat-window-open";
const CHAT_WINDOW_MINIMIZED_KEY = "im-chat-window-minimized";

function getChatWindowStateFromStorage(): {
  isOpen: boolean;
  isMinimized: boolean;
} {
  if (typeof window === "undefined")
    return { isOpen: false, isMinimized: false };
  try {
    const open = sessionStorage.getItem(CHAT_WINDOW_OPEN_KEY) === "1";
    const minimized = sessionStorage.getItem(CHAT_WINDOW_MINIMIZED_KEY) === "1";
    return { isOpen: open, isMinimized: minimized };
  } catch {
    return { isOpen: false, isMinimized: false };
  }
}

function saveChatWindowStateToStorage(
  isOpen: boolean,
  isMinimized: boolean,
): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(CHAT_WINDOW_OPEN_KEY, isOpen ? "1" : "0");
    sessionStorage.setItem(CHAT_WINDOW_MINIMIZED_KEY, isMinimized ? "1" : "0");
  } catch {
    // ignore
  }
}

/** 未读消息数：来自 Bot/Agent 且 status !== read 的消息 */
export function countUnread(
  messages: Message[],
  userId: string | undefined,
): number {
  if (!userId) return 0;
  return messages.filter(
    (m) =>
      m.senderType !== SenderType.USER &&
      m.senderType !== SenderType.SYSTEM &&
      m.status !== "read",
  ).length;
}

/** 输入中状态：Bot/Agent 正在输入时 */
interface TypingState {
  isTyping: boolean;
  senderType: SenderType | null;
}

/** 排队状态：转人工时 position、预估等待时间 */
interface QueueState {
  position: number;
  total: number;
  estimatedWait: number;
}

/** 认证信息：JWT token、userId、钱包地址 */
interface AuthState {
  token: string;
  userId: string;
  address: string;
}

interface ChatState {
  // ---------- 认证：登录后才能 initialize，KICKED 时清空 ----------
  client: IMClient | null;
  auth: AuthState | null;
  authError: string | null;
  authConnecting: boolean; // 访客/钱包登录中，用于按钮 loading

  // ---------- 连接：CONNECTED/DISCONNECTED/RECONNECTING，Header 等展示 ----------
  connectionState: ConnectionState;

  // ---------- 会话：单会话，当前 Bot/Agent 对话 ----------
  conversationId: string; // 当前会话 ID（persist 用，用于离线恢复时匹配）
  phase: ConversationPhase; // BOT | QUEUING | AGENT | CLOSED
  agentInfo: AgentInfo | null; // 转人工后 Agent 信息
  queue: QueueState | null; // 排队中 position/total
  messages: Message[]; // 当前会话消息，按 seq/timestamp 排序
  faqItems: FAQItem[]; // Bot 阶段 FAQ 配置

  // ---------- 会话辅助：历史分页、输入中、在线 ----------
  typing: TypingState; // Bot/Agent 正在输入
  hasMoreHistory: boolean;
  loadingHistory: boolean;
  onlineUsers: string[]; // 在线 userId 列表

  // ---------- UI：弹窗、引用、滚动、搜索 ----------
  isMinimized: boolean;
  isExpanded: boolean; // 放大/缩小模式
  isOpen: boolean;
  showWalletModal: boolean;
  wantFreshStart: boolean; // 新建会话不拉历史
  searchResults: Message[] | null;
  quoteTarget: Message | null; // 引用回复目标
  /** 点击回复时触发，用于滚动到底部并聚焦输入框 */
  scrollToInputRequest: number;
  /** 临时 Toast 文案，用于撤回失败等提示 */
  toast: string | null;
  /** WebSocket 序列化格式：json（默认）| protobuf（高 QPS 更快更小） */
  format: SerializeFormat;

  setShowWalletModal: (v: boolean) => void;
  setQuoteTarget: (msg: Message | null) => void;
  /** 点击回复：设置引用目标并请求滚动到输入框 */
  replyToMessage: (msg: Message) => void;
  setWantFreshStart: (v: boolean) => void;
  connectWallet: () => Promise<boolean>;
  connectAsGuest: () => Promise<boolean>;
  initialize: () => Promise<void>;
  sendMessage: (content: string) => void;
  sendFile: (file: File) => void;
  selectFAQ: (faqId: string) => void;
  requestAgent: () => void;
  toggleMinimize: () => void;
  toggleExpand: () => void; // 放大/缩小
  toggleOpen: () => void;
  /** 客户端挂载后从 sessionStorage 恢复 isOpen/isMinimized，避免 hydration 与 SSR 不一致 */
  rehydrateChatWindowState: () => void;
  destroy: () => void;
  loadMoreHistory: () => void;
  markAsRead: (messageIds: string[]) => void;
  addReaction: (messageId: string, emoji: string) => void;
  removeReaction: (messageId: string, emoji: string) => void;
  sendSticker: (stickerId: string) => void;
  /** 发送交易卡片（智能客服同 chat 页） */
  sendTradeCard: (payload: TradeCardPayload) => void;
  searchMessages: (query: string) => Promise<void>;
  clearSearch: () => void;
  editMessage: (messageId: string, newContent: string) => void;
  recallMessage: (messageId: string) => void;
  /** 带撤回前高度的撤回（供 MessageItem/滚动补偿用）；先通知列表再 recallMessage */
  recallWithCompensation: (messageId: string, previousHeight: number) => void;
  /** 模拟对方撤回某条消息（仅更新 store，用于验证撤回后是否跳动） */
  simulateOtherRecallMessage: (messageId: string, previousHeight: number) => void;
  showToast: (msg: string) => void;
  clearToast: () => void;
  setFormat: (format: SerializeFormat) => void;
  /** 请求服务端推送 N 条 Mock 消息（用于 Protobuf/分片 Demo） */
  requestSimulatePush: (count: number) => void;
  /** 本地模拟对方一次性发送 N 条消息（不经过 WS，直接写入 store，用于压测/演示） */
  simulateIncomingMessages: (count: number) => void;
  /** 从 client 同步连接状态到 store，用于刷新后或重连后 UI 与真实连接态一致 */
  syncConnectionState: () => void;
}

/** MessageList 挂载时注册，发消息后由 store 调用，确保滚底不依赖 effect 时序 */
let chatScrollToBottomCallback: (() => void) | null = null;
export function registerChatScrollToBottom(fn: (() => void) | null): void {
  chatScrollToBottomCallback = fn;
}

/** MessageList 注册「撤回前高度」，用于撤回/模拟对方撤回时做滚动补偿 */
let recallWithCompensationCallback: ((messageId: string, previousHeight: number) => void) | null = null;
export function registerRecallWithCompensation(fn: ((messageId: string, previousHeight: number) => void) | null): void {
  recallWithCompensationCallback = fn;
}

export const useChatStore = create<ChatState>()(
  persist(
    immer((set, get) => ({
    // ---------- 状态（分组与 interface 注释对应，便于按业务域维护） ----------
    client: null,
    auth: null,
    authError: null,
    authConnecting: false,
    connectionState: ConnectionState.DISCONNECTED,
    conversationId: "",
    phase: ConversationPhase.BOT,
    agentInfo: null,
    messages: [],
    faqItems: DEFAULT_FAQ_ITEMS,
    typing: { isTyping: false, senderType: null },
    queue: null,
    // 初始固定为关闭，避免 SSR 与客户端 hydration 不一致（sessionStorage 仅客户端有）
    isOpen: false,
    isMinimized: false,
    isExpanded: false,
    showWalletModal: false,
    wantFreshStart: false,
    onlineUsers: [],
    hasMoreHistory: true,
    loadingHistory: false,
    searchResults: null,
    quoteTarget: null,
    /** 时间戳信号：replyToMessage 时更新，InputArea 监听后滚动并聚焦 */
    scrollToInputRequest: 0,
    toast: null,
    format: "json" as SerializeFormat,

    // ---------- 简单 setter ----------
    setShowWalletModal: (v: boolean) => set({ showWalletModal: v }),
    setQuoteTarget: (msg: Message | null) => set({ quoteTarget: msg }),
    replyToMessage: (msg: Message) =>
      set({ quoteTarget: msg, scrollToInputRequest: Date.now() }),
    setWantFreshStart: (v: boolean) => set({ wantFreshStart: v }),
    setFormat: (format: SerializeFormat) => set({ format }),

    // ---------- 认证 ----------
    connectWallet: async () => {
      set({ authError: null });
      try {
        const { token, userId, address } = await signInWithWallet();
        set({ auth: { token, userId, address }, authError: null });
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Wallet connection failed";
        set({ authError: msg });
        return false;
      }
    },

    connectAsGuest: async () => {
      set({ authError: null, authConnecting: true });
      try {
        const res = await fetch("/api/auth/demo");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ||
              `Demo auth failed (${res.status})`,
          );
        }
        const { token, userId, address } = await res.json();
        set({
          auth: { token, userId, address },
          authError: null,
          authConnecting: false,
        });
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Guest connection failed";
        console.error("[connectAsGuest]", e);
        set({ authError: msg, authConnecting: false });
        return false;
      }
    },

    /** 初始化 IM：创建 IMClient、订阅 SDKEvent、连接 WebSocket、同步初始状态 */
    initialize: async () => {
      const { auth, wantFreshStart } = get();
      if (!auth) {
        set({ authError: "Please connect wallet first" });
        return;
      }
      set({
        authError: null,
        wantFreshStart: false,
        connectionState: ConnectionState.CONNECTING,
      });

      const wsUrl =
        typeof window !== "undefined"
          ? `ws://${window.location.hostname}:3001/ws`
          : "ws://localhost:3001/ws";
      const apiBase =
        typeof window !== "undefined"
          ? `${window.location.protocol}//${window.location.hostname}:3001`
          : "http://localhost:3001";

      let client: IMClient;
      try {
        client = createIMClient({
          userId: auth.userId,
          token: auth.token,
          url: wsUrl,
          apiBaseUrl: apiBase,
          fresh: wantFreshStart,
          format: "json",
          getPersistedMessages: async (conversationId: string) => {
            const s = await getPersistedChatState();
            if (s?.conversationId === conversationId && s.messages?.length)
              return s.messages as unknown as Message[];
            return [];
          },
        });
      } catch (e) {
        set({ connectionState: ConnectionState.DISCONNECTED });
        console.error("[initialize] createIMClient failed", e);
        return;
      }

      // 连接状态
      client.on(SDKEvent.CONNECTED, () =>
        set({ connectionState: ConnectionState.CONNECTED }),
      );
      client.on(SDKEvent.DISCONNECTED, () =>
        set({ connectionState: ConnectionState.DISCONNECTED }),
      );
      client.on(SDKEvent.RECONNECTING, () =>
        set({ connectionState: ConnectionState.RECONNECTING }),
      );
      //         Immer 会 freeze 的是一整棵新的 state 树，也就是：
      // 根对象 state
      // state.messages 数组
      // state.messages 里的每个消息对象
      // 这些都会被 Object.freeze，变成不可修改的。
      // 消息：单条/批量接收、发送、状态更新
      // 收到事件后，把消息拷贝一份 push 到 state.messages，
      // /UI 因此立刻看到新消息，实现乐观更新。后续服务端 ACK 会触发 MESSAGE_STATUS_UPDATE 更新状态。
      client.on(SDKEvent.MESSAGE_SENT, (msg: unknown) => {
        const message = msg as Message;
        set((state) => {
          if (state.messages.some((m) => m.id === message.id)) return;
          //  浅拷贝：{ ...obj } 或 Object.assign({}, obj)
          // 深拷贝：structuredClone(obj)、JSON.parse(JSON.stringify(obj))
          // 用 { ...message } 造出一个新对象，再 push 进 state.messages
          // Immer 只 freeze 这个新对象，不会动 IMClient 手里的原始 message
          // IMClient 的 conversation.messages 里仍然是原来的对象，可以继续修改
          // immer 在 set() 执行完成后，会 freeze 整棵新的 state 树，是只读的，不能再做赋值或修改。
          state.messages.push({ ...message }); // 拷贝：Immer 会 freeze 新 state，不能与 IMClient 共享引用
          state.scrollToInputRequest = Date.now();
        });
        // 直接调用 MessageList 注册的滚底回调（延后一帧，等 React 提交后再滚），不依赖 effect 时序
        setTimeout(() => chatScrollToBottomCallback?.(), 0);
      });
      // 在 Immer 里，传给 set 的回调拿到的是 draft（草稿），不是真实 state：
      // 可以直接对 state 做“可变”操作：push、splice、state.xxx = yyy
      // Immer 会在内部记录这些修改
      // 回调结束后，Immer 根据 draft 的变更生成新的不可变 state
      // 不需要显式 return 新对象
      // 收到单条消息：auth_ok 历史 1 条、frame_in 实时 1 条、sync 增量 1 条、系统消息等
      // 因此不需要在最后 return 任何对象。
      client.on(SDKEvent.MESSAGE_RECEIVED, (msg: unknown) => {
        const message = msg as Message;
        set((state) => {
          if (state.messages.some((m) => m.id === message.id)) return;
          state.messages.push({ ...message }); // 拷贝：Immer freeze 后不能与 IMClient 共享引用
        });
        // 对方发来新消息后也触底，和 MESSAGE_SENT 一致，避免只依赖 followOutput 导致不滚
        setTimeout(() => chatScrollToBottomCallback?.(), 0);
      });
      // 收到批量消息：auth_ok 历史多条、frame_in 实时多条、sync_response 增量多条
      // new Set(...)：转成 Set，方便用 ids.has(m.id) 快速判断是否存在
      // if (!ids.has(m.id))：只有 id 不在集合里的才 push
      // ids.add(m.id)：新加的 id 也放进集合，避免 batch 内部重复的 id 被多次 push
      // 按 id 去重，确保同一 id 的消息在 state.messages 里只出现一次。
      client.on(SDKEvent.MESSAGE_BATCH_RECEIVED, (msgs: unknown) => {
        const batch = msgs as Message[];
        if (batch.length === 0) return;
        set((state) => {
          // 按消息 id 做去重判断
          const ids = new Set(state.messages.map((m) => m.id));
          for (const m of batch) {
            if (!ids.has(m.id)) {
              state.messages.push({ ...m }); // 拷贝：Immer freeze 后不能与 IMClient 共享引用
              ids.add(m.id);
            }
          }
        });
        // 批量收到新消息后也触底（如 auth_ok 历史、sync 补量等末尾有新区间时）
        setTimeout(() => chatScrollToBottomCallback?.(), 0);
      });

      // MESSAGE_STATUS_UPDATE：服务端 ACK 后只更新 status、seqId（不改 id，避免列表 key 变化导致重排/闪烁）
      client.on(SDKEvent.MESSAGE_STATUS_UPDATE, (msg: unknown) => {
        const message = msg as Message;
        set((state) => {
          const m = state.messages.find((x) => x.id === message.id);
          if (m) {
            m.status = message.status;
            if (message.seqId != null) m.seqId = message.seqId;
            if (message.metadata)
              m.metadata = { ...m.metadata, ...message.metadata };
          }
        });
      });
      // MESSAGE_SEND_FAILED：消息发送失败（如网络错误、ACK 超时）
      client.on(SDKEvent.MESSAGE_SEND_FAILED, (msg: unknown) => {
        const message = msg as Message;
        set((state) => {
          const m = state.messages.find((x) => x.id === message.id);
          if (m) m.status = "failed";
        });
      });

      // PHASE_CHANGED：会话阶段变更（BOT→QUEUING→AGENT→CLOSED），服务端推送或本地转人工后
      // Bot → 排队中 → Agent → 已结束
      // 更新当前会话阶段 phase（BOT / QUEUING / AGENT / CLOSED）
      // 来源：服务端推送或本地逻辑（如请求转人工后）
      client.on(SDKEvent.PHASE_CHANGED, (phase: unknown) =>
        set({ phase: phase as ConversationPhase }),
      );
      // MESSAGES_RESET：整表替换消息，非增量。新建会话、会话重置、服务端下发全新消息时触发
      // payload 支持 { messages, conversationId } 或直接为 Message[]
      //         作用：整体替换当前消息列表，而不是增量追加
      // 使用场景：新建会话、会话被重置、服务端下发全新消息集合
      // 逻辑：
      // 支持 { messages, conversationId } 或直接传消息数组
      // 用 msgs.map((m) => ({ ...m })) 做浅拷贝，避免和 IMClient 共享引用
      // 同时更新 conversationId（若有）
      client.on(SDKEvent.MESSAGES_RESET, (payload: unknown) => {
        const data = payload as {
          messages?: Message[];
          conversationId?: string;
        };
        const msgs = data.messages ?? (payload as Message[]);
        set({
          messages: Array.isArray(msgs) ? msgs.map((m) => ({ ...m })) : [], // 拷贝，不与 IMClient 共享引用
          conversationId: data.conversationId ?? get().conversationId,
        });
      });
      // AGENT_ASSIGNED：转人工成功，分配了客服。更新 agentInfo，清空 queue，queue: null：不再排队
      client.on(SDKEvent.AGENT_ASSIGNED, (info: unknown) =>
        set({ agentInfo: info as AgentInfo, queue: null }),
      );
      // QUEUE_UPDATE：排队中状态更新，payload 含 position/total/estimatedWait
      client.on(SDKEvent.QUEUE_UPDATE, (data: unknown) =>
        set({ queue: data as QueueState }),
      );
      // TYPING_START：Bot/Agent 正在输入，显示「对方正在输入」
      client.on(SDKEvent.TYPING_START, (data: unknown) => {
        const d = data as { senderType: SenderType };
        set({ typing: { isTyping: true, senderType: d.senderType } });
      });
      // TYPING_STOP：对方停止输入
      // 预期流程
      // 服务端在 Bot/Agent 开始输入时，通过 WebSocket 下发 type: "typing" 的帧，payload 中可能包含 { senderType } 等。
      // 服务端在对方停止输入或发送消息后，下发 typing_stop 或类似帧。
      // 客户端收到后更新 typing 状态，UI 显示「对方正在输入」。
      // 设计上：typing 由服务端推送，客户端只负责更新 UI。
      // 现状：WebSocketManager 未处理 FrameType.TYPING，TYPING_START / TYPING_STOP 目前不会被触发。
      client.on(SDKEvent.TYPING_STOP, () =>
        set({ typing: { isTyping: false, senderType: null } }),
      );
      // HISTORY_LOADED：向上翻页拉取更早历史。去重后 prepend 到顶部，按 seqId/timestamp 排序
      //  用户滚动到消息列表顶部
      // → loadMoreHistory()
      // → 取当前 messages 中最小 seqId
      // → client.loadHistory(minSeq)  发送 WebSocket 帧
      // → 服务端返回 history_response
      // → IMClient 处理并 emit HISTORY_LOADED
      //         // → chatStore 订阅 HISTORY_LOADED，执行下面这段 set
      //         向上翻页拉的是更早的消息（seqId 更小）
      // 在 UI 上应显示在列表顶部
      // 因此要把新拉到的 prepend 放在前面：[...prepend, ...state.messages]
      //         prepend 是服务端按 seq 返回的
      // state.messages 可能按时间/seq 有序
      // 合并后仍需按 seqId ?? timestamp 统一排序，保证时间线正确
      client.on(SDKEvent.HISTORY_LOADED, (payload: unknown) => {
        const { messages: newMsgs, hasMore } = payload as {
          messages: Message[];
          hasMore: boolean;
        };
        set((state) => {
          state.hasMoreHistory = hasMore ?? state.hasMoreHistory;
          state.loadingHistory = false;
          if (!newMsgs?.length) return;
          const ids = new Set(state.messages.map((m) => m.id)); // 按 id 去重
          const prepend = newMsgs.filter((m) => !ids.has(m.id));
          // 从小到大（升序）排序。时间从早到晚。
          state.messages = [...prepend, ...state.messages].sort(
            (a, b) => (a.seqId ?? a.timestamp) - (b.seqId ?? b.timestamp),
          );
        });
      });
      // PRESENCE_UPDATE：在线用户列表变更，payload 含 { online: string[] }
      client.on(SDKEvent.PRESENCE_UPDATE, (payload: unknown) => {
        const { online } = payload as { online?: string[] };
        if (Array.isArray(online)) set({ onlineUsers: online });
      });
      // READ_RECEIPT：已读回执。payload 含 messageIds、readBy，更新对应消息 status 和 metadata.readBy
      //         payload = { messageIds: ["msg-1", "msg-2"], readBy: "agent-001" }
      // 表示 agent-001 读了 msg-1 和 msg-2
      client.on(SDKEvent.READ_RECEIPT, (payload: unknown) => {
        const { messageIds, readBy } = payload as {
          messageIds?: string[];
          readBy?: string;
        };
        if (!messageIds?.length || !readBy) return;
        set((state) => {
          for (const m of state.messages) {
            if (!messageIds.includes(m.id)) continue;
            const meta = (m.metadata as { readBy?: string[] }) ?? {};
            const readByList = meta.readBy ?? [];
            if (readByList.includes(readBy)) continue;
            m.status = "read";
            if (!meta.readBy) meta.readBy = [];
            meta.readBy.push(readBy);
            m.metadata = meta;
          }
        });
      });
      // REACTION_UPDATE：表情反应更新。支持 messageId/clientMsgId 匹配（消息可能尚未 ACK）
      // 1	遍历当前会话的消息
      // 2	用 messageId 或 clientMsgId 找到目标消息
      // 3	若有 messageId，更新 m.id，保证与服务端一致
      // 4	取 metadata（空则用 {}），设置 meta.reactions = reactions
      // 5	把更新后的 meta 写回 m.metadata
      client.on(SDKEvent.REACTION_UPDATE, (payload: unknown) => {
        const { messageId, clientMsgId, reactions } = payload as {
          messageId?: string;
          clientMsgId?: string;
          reactions?: Record<string, string[]>;
        };
        if (!reactions) return;
        set((state) => {
          //             messageId：服务端分配的最终 id（ACK 之后才有）
          // clientMsgId：客户端发送时生成的临时 id（还没 ACK 时用这个）
          // 同时支持 messageId 和 clientMsgId 匹配，能覆盖「已 ACK」和「未 ACK」两种情况。
          for (const m of state.messages) {
            const matches =
              m.id === messageId ||
              (clientMsgId && m.id === clientMsgId) ||
              (messageId &&
                (m.metadata as { serverMsgId?: string })?.serverMsgId ===
                  messageId);
            if (!matches) continue;
            // 不改 m.id，避免列表 key 变化导致重排
            const meta = (m.metadata as Record<string, unknown>) ?? {};
            // reactions 是服务端下发的最新反应快照，{ "👍": ["user-1", "user-2"], "❤️": ["user-3"] }
            // 避免本地再去合并、去重，减少状态不一致
            // metadata 是扩展字段，可以放任意业务数据
            // reactions 属于「和这条消息相关的附加信息」，放在 metadata.reactions 比较合理
            // 也有利于和 readBy 等字段一起，通过 metadata 统一管理
            meta.reactions = reactions;
            m.metadata = meta;
          }
        });
      });
      // MESSAGE_EDIT：编辑回执，同步多端或确认乐观更新（服务端可能回传 clientMsgId 或 serverMsgId，用 id 或 metadata.serverMsgId 匹配）
      client.on(SDKEvent.MESSAGE_EDIT, (payload: unknown) => {
        const { messageId, content } = payload as {
          messageId?: string;
          content?: string;
        };
        if (!messageId || content == null) return;
        set((state) => {
          const m = state.messages.find(
            (x) =>
              x.id === messageId ||
              (x.metadata as { serverMsgId?: string })?.serverMsgId ===
                messageId,
          );
          if (m) m.content = content;
        });
      });
      // MESSAGE_RECALL：撤回回执，同步多端或确认乐观更新
      client.on(SDKEvent.MESSAGE_RECALL, (payload: unknown) => {
        const { messageId } = payload as { messageId?: string };
        if (!messageId) return;
        if (_pendingRecallRevert?.messageId === messageId)
          _pendingRecallRevert = null;
        set((state) => {
          const m = state.messages.find(
            (x) =>
              x.id === messageId ||
              (x.metadata as { serverMsgId?: string })?.serverMsgId ===
                messageId,
          );
          if (m) {
            m.content = "已撤回";
            m.type = MessageType.TEXT;
            const meta = (m.metadata as Record<string, unknown>) ?? {};
            meta.recalled = true;
            m.metadata = meta;
          }
        });
      });
      // server_error：撤回/编辑等业务错误，回滚乐观更新并 Toast 提示
      client.on("server_error", (payload: unknown) => {
        const p = payload as {
          code?: string;
          message?: string;
          messageId?: string;
        };
        const toastMsg =
          typeof p.message === "string" ? p.message : "操作失败，请重试";
        if (
          p.code === "recall_expired" &&
          p.messageId &&
          _pendingRecallRevert?.messageId === p.messageId
        ) {
          const { messageId, content } = _pendingRecallRevert;
          _pendingRecallRevert = null;
          set((state) => {
            const m = state.messages.find((x) => x.id === messageId);
            if (m) m.content = content;
          });
        }
        get().showToast(toastMsg);
      });
      // KICKED：同账号多地登录被踢下线
      client.on(SDKEvent.KICKED, () => {
        set({
          authError: "Logged in elsewhere",
          connectionState: ConnectionState.DISCONNECTED,
        });
      });

      try {
        await client.connect();
      } catch (e) {
        set({ connectionState: ConnectionState.DISCONNECTED });
        console.error("[initialize] client.connect failed", e);
        get().showToast?.("连接失败，请检查网络或稍后重试");
        return;
      }

      // connect 完成后，把 IMClient 的 conversation 同步到 Store（client、messages 浅拷贝等）
      const conv = client.getConversation();
      set({
        client,
        connectionState: ConnectionState.CONNECTED,
        conversationId: conv.id,
        faqItems: client.getFAQItems(),
        messages: conv.messages.map((m) => ({ ...m })), // 拷贝：不与 IMClient 共享引用
        isOpen: true,
        hasMoreHistory: true,
      });
      saveChatWindowStateToStorage(true, get().isMinimized);
      // 下一 tick 再同步一次连接态，避免批处理导致 UI 未刷新
      setTimeout(() => get().syncConnectionState(), 0);
    },

    // ---------- 消息操作 ----------
    // 发送文本消息，支持引用回复（quoteTarget）。发送后清空 quoteTarget
      sendMessage: (content: string) => {
        const { client, quoteTarget } = get();
        if (!content.trim()) return;
        if (!client) {
          get().showToast?.("连接未就绪，请稍后再试");
          return;
        }
        const metadata = quoteTarget
        ? {
            quote: {
              messageId: quoteTarget.id,
              senderName: quoteTarget.senderName,
              content: (quoteTarget.content ?? "").slice(0, 200),
              type: quoteTarget.type,
              timestamp: quoteTarget.timestamp,
            },
          }
        : undefined;
      set({ quoteTarget: null }); // 发送后清空引用
      client.sendMessage(content.trim(), MessageType.TEXT, metadata);
    },

    sendFile: (file: File) => {
      const { client } = get();
      if (!client) return;
      client.sendFile(file);
    },

    selectFAQ: (faqId: string) => {
      const { client } = get();
      if (!client) return;
      client.selectFAQ(faqId);
    },

    requestAgent: () => {
      const { client } = get();
      if (!client) return;
      client.requestHumanAgent();
    },

    toggleMinimize: () =>
      set((state) => {
        state.isMinimized = !state.isMinimized;
        saveChatWindowStateToStorage(state.isOpen, state.isMinimized);
      }),
    toggleExpand: () =>
      set((state) => {
        state.isExpanded = !state.isExpanded;
      }),
    toggleOpen: () =>
      set((state) => {
        state.isOpen = !state.isOpen;
        saveChatWindowStateToStorage(state.isOpen, state.isMinimized);
      }),
    rehydrateChatWindowState: () => {
      const { isOpen, isMinimized } = getChatWindowStateFromStorage();
      set({ isOpen, isMinimized });
    },

    /** 滚动到顶部时拉取更早历史：取当前最小 seq，发 load_history */
    loadMoreHistory: () => {
      const { client, messages, hasMoreHistory, loadingHistory } = get();
      if (!client || !hasMoreHistory || loadingHistory) return;
      const withSeq = messages.filter((m) => m.seqId != null || m.timestamp);
      if (withSeq.length === 0) return;
      set({ loadingHistory: true });
      const minSeq = Math.min(
        ...withSeq.map((m) => (m.seqId ?? m.timestamp) as number),
      );
      client.loadHistory(minSeq);
      // 服务端异步返回 HISTORY_LOADED，超时兜底防止 loading 一直为 true
      setTimeout(() => set({ loadingHistory: false }), 1500);
    },

    /** 标记已读：乐观更新 Store（先标为 read），再同步服务端；READ_RECEIPT 作为确认 */
    markAsRead: (messageIds: string[]) => {
      if (messageIds.length === 0) return;
      set((state) => {
        for (const m of state.messages) {
          if (messageIds.includes(m.id)) m.status = MessageStatus.READ;
        }
      });
      get().client?.markAsRead(messageIds);
    },

    /** 添加反应：乐观更新 Store，再调 client.addReaction 同步服务端 */
    addReaction: (messageId: string, emoji: string) => {
      const { client, auth } = get();
      if (!client || !auth?.userId) return;
      set((state) => {
        const msg = state.messages.find((m) => m.id === messageId);
        if (!msg) return;
        const meta =
          (msg.metadata as { reactions?: Record<string, string[]> }) ?? {};
        if (!meta.reactions) meta.reactions = {};
        if (!meta.reactions[emoji]) meta.reactions[emoji] = [];
        meta.reactions[emoji] = meta.reactions[emoji].filter(
          (u) => u !== auth!.userId,
        );
        meta.reactions[emoji].push(auth!.userId);
        msg.metadata = meta;
      });
      client.addReaction(messageId, emoji);
    },

    /** 移除反应：乐观更新 Store，再调 client.removeReaction */
    removeReaction: (messageId: string, emoji: string) => {
      const { client, auth } = get();
      if (!client || !auth?.userId) return;
      set((state) => {
        const msg = state.messages.find((m) => m.id === messageId);
        if (!msg) return;
        const meta =
          (msg.metadata as { reactions?: Record<string, string[]> }) ?? {};
        if (!meta.reactions?.[emoji]) return;
        meta.reactions[emoji] = meta.reactions[emoji].filter(
          (u) => u !== auth!.userId,
        );
        if (meta.reactions[emoji].length === 0) delete meta.reactions[emoji];
        msg.metadata = meta;
      });
      client.removeReaction(messageId, emoji);
    },

    sendSticker: (stickerId: string) => {
      get().client?.sendSticker(stickerId);
    },

    sendTradeCard: (payload: TradeCardPayload) => {
      const { client } = get();
      if (!client) return;
      const content = `${payload.side === "buy" ? "买入" : "卖出"} ${payload.symbol}`;
      client.sendMessage(content, MessageType.TRADE_CARD, { tradeCard: payload });
    },

    searchMessages: async (query: string) => {
      const { client } = get();
      if (!client || !query.trim()) return;
      const results = await client.searchMessages(query.trim());
      set({ searchResults: results });
    },

    clearSearch: () => set({ searchResults: null }),

    /** 编辑消息：乐观更新 Store + 同步服务端，仅文本消息可编辑 */
    editMessage: (messageId: string, newContent: string) => {
      const { auth, client } = get();
      if (!auth?.userId || !newContent.trim()) return;
      set((state) => {
        const m = state.messages.find(
          (x) =>
            x.id === messageId &&
            x.senderId === auth!.userId &&
            x.type === MessageType.TEXT,
        );
        if (m) m.content = newContent.trim();
      });
      client?.editMessage(messageId, newContent.trim());
    },

    /** 撤回消息：乐观更新 Store + 同步服务端，2 分钟内可撤回 */
    recallMessage: (messageId: string) => {
      const { auth, client } = get();
      if (!auth?.userId) return;
      const msg = get().messages.find(
        (m) => m.id === messageId && m.senderId === auth!.userId,
      );
      if (msg) _pendingRecallRevert = { messageId, content: msg.content };
      set((state) => {
        const m = state.messages.find(
          (x) => x.id === messageId && x.senderId === auth!.userId,
        );
        if (m) {
          m.content = "已撤回";
          m.type = MessageType.TEXT;
          const meta = (m.metadata as Record<string, unknown>) ?? {};
          meta.recalled = true;
          m.metadata = meta;
        }
      });
      client?.recallMessage(messageId);
    },

    recallWithCompensation: (messageId: string, previousHeight: number) => {
      recallWithCompensationCallback?.(messageId, previousHeight);
      get().recallMessage(messageId);
    },

    simulateOtherRecallMessage: (messageId: string, previousHeight: number) => {
      recallWithCompensationCallback?.(messageId, previousHeight);
      set((state) => {
        const m = state.messages.find((x) => x.id === messageId);
        if (m) {
          m.content = "已撤回";
          m.type = MessageType.TEXT;
          const meta = (m.metadata as Record<string, unknown>) ?? {};
          meta.recalled = true;
          m.metadata = meta;
        }
      });
    },

    showToast: (msg: string) => set({ toast: msg }),
    clearToast: () => set({ toast: null }),

    requestSimulatePush: (count: number) => {
      const { client } = get();
      client?.requestSimulatePush(count);
    },

    /** 本地模拟对方一次性发送 N 条消息（不经过 WS），用于压测/演示；第一条为图片便于测试「模拟对方撤回图片」 */
    simulateIncomingMessages: (count: number) => {
      const { conversationId, phase, messages } = get();
      if (!conversationId || count < 1) return;
      const maxSeq = Math.max(0, ...messages.map((m) => m.seqId ?? 0));
      const senderType =
        phase === ConversationPhase.AGENT ? SenderType.AGENT : SenderType.BOT;
      const senderId = phase === ConversationPhase.AGENT ? "agent-1" : "bot";
      const senderName = phase === ConversationPhase.AGENT ? "客服" : "Bot";
      const baseTime = Date.now();
      const newMessages: Message[] = [];
      for (let i = 0; i < count; i++) {
        const isFirst = i === 0;
        newMessages.push({
          id: `sim-${baseTime}-${i}-${Math.random().toString(36).slice(2, 9)}`,
          conversationId,
          content: isFirst
            ? "https://picsum.photos/320/240"
            : `模拟消息 ${i + 1}`,
          type: isFirst ? MessageType.IMAGE : MessageType.TEXT,
          status: MessageStatus.READ,
          senderType,
          senderId,
          senderName,
          timestamp: baseTime + i,
          seqId: maxSeq + i + 1,
        });
      }
      set((state) => {
        for (const m of newMessages) state.messages.push({ ...m });
      });
    },

    /** 从 client 同步连接状态到 store，用于刷新后或重连后 UI 与真实连接态一致 */
    syncConnectionState: () => {
      const { client } = get();
      if (client) {
        const cs = client.getConnectionState();
        set({ connectionState: cs });
      }
    },

    /** 销毁：断开连接、移除监听、重置所有状态 */
    destroy: () => {
      const { client } = get();
      if (client) {
        client.disconnect();
        client.removeAllListeners();
      }
      //         不依赖 state 做计算
      // 只是想一次性重置多个字段
      // 直接传对象更简洁
      // Zustand 会把传入的对象和当前 state 做合并（merge），未提及的字段保持不变，提及的字段会被更新。
      set({
        client: null,
        connectionState: ConnectionState.DISCONNECTED,
        conversationId: "",
        messages: [],
        quoteTarget: null,
        scrollToInputRequest: 0,
        phase: ConversationPhase.BOT,
        agentInfo: null,
        queue: null,
        isOpen: false,
        isExpanded: false,
        onlineUsers: [],
        hasMoreHistory: true,
        loadingHistory: false,
        searchResults: null,
      });
    },
  })),
  {
    name: CHAT_PERSIST_NAME,
    storage: createJSONStorage(() => chatPersistStorage),
    partialize: (s) => ({
      messages: s.messages,
      conversationId: s.conversationId,
    }),
    merge: (persisted, state) => {
      const cur = (state as ChatState).messages ?? [];
      const per = (persisted as { messages?: Message[] })?.messages ?? [];
      const curMax = cur.reduce((m, x) => Math.max(m, x.seqId ?? 0), 0);
      const perMax = per.reduce((m, x) => Math.max(m, x.seqId ?? 0), 0);
      // 采用 IndexedDB 列表时规范化：sending → failed，避免恢复后仍显示「发送中」（见 chatPersistStorage 文档）
      const messages: Message[] =
        curMax >= perMax
          ? cur
          : (normalizePersistedMessages(per as unknown as Array<Record<string, unknown>>) as unknown as Message[]);
      return {
        ...(state as ChatState),
        ...(persisted as Record<string, unknown>),
        messages,
      };
    },
  }
  )
);

// persist：messages/conversationId 写入 IndexedDB，刷新后 rehydration 恢复；merge 时取 seqId 更完整的一方，避免旧快照覆盖 sync 补全
