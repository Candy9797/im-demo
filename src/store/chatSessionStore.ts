"use client";

/**
 * chatSessionStore - 聊天会话页面状态（好友/群组）
 *
 * ## 为何与 chatStore 分开？
 * - 业务域不同：本 store 是「好友/群组」场景，Mock 数据、多会话切换（c2c/group）
 * - chatStore 是「客服 Bot/Agent」场景，WebSocket、单会话、服务端同步
 * - 路由分离：/ 用 chatStore（客服入口），/chat-session 用 chatSessionStore
 * - 分开后：各自订阅互不影响，客服消息变化不会触发好友列表重渲染
 *
 * ## 状态划分说明
 * | 分类 | 字段 | 为何单独一组 | 触发更新的来源 |
 * |------|------|--------------|----------------|
 * | 会话列表 | friends, groups, activeConversation | 侧边栏展示 + 当前选中，active 决定主区域显示哪个会话 | selectFriend、selectGroup |
 * | 消息 | messagesByConv | 多会话按 key 分桶，key=c2c:userId 或 groupId | sendMessage、sendImage 等 |
 * | 输入/在线 | typingByUser, typingByGroup, onlineByUser | 单聊按 userId、群聊按 groupId，结构不同 | setTyping、setOnline |
 *
 * ## Immer 中间件说明
 *
 * immer 不是把 store 变成「运行时不可变对象」，而是让 set 的回调支持**可变式写法**，
 * 内部用 Immer 的 draft 机制自动转成**不可变更新**。
 *
 * ### 工作原理
 * 1. set((state) => { ... }) 时，传入的 state 实际是 Immer 的 draft（代理对象）
 * 2. 在回调里可直接写 state.xxx = yyy、state.list.push(x)，看起来像「可变」
 * 3. 回调结束后，Immer 根据对 draft 的修改生成**新的不可变 state**（结构共享）
 * 4. Zustand 用新 state 替换旧 state，触发订阅更新
 *
 * ### 为何用 Immer？
 * - 不用 Immer：需手写 { ...state, messagesByConv: { ...state.messagesByConv, [key]: [...list, msg] } }，嵌套越深越繁琐
 * - 用 Immer：直接 state.messagesByConv[key] = [...list, msg]，等价于不可变更新
 *
 * ### 注意
 * - draft 仅在 set 回调内有效，不能在回调外保存引用
 * - 直接 set({ x: 1 }) 传对象时，对象本身不会被 Immer 处理，只有 set(fn) 才会走 draft
 * 不一定要传函数。重点是：只有传函数时才会走 Immer 的 draft 机制。
两种 set 用法
写法	Immer 是否介入	行为
set({ x: 1 })	❌ 不介入	直接替换/合并 state，和普通 Zustand 一样
set((state) => { state.x = 1 })	✅ 介入	state 是 draft，可直接改，Immer 会生成新的不可变 state
两则「注意」的含义
1. draft 只在回调内有效
// ❌ 错误set((state) => {  window.myDraft = state;  // 别保存到外面  state.x = 1;});// 回调结束后，state/draft 失效，window.myDraft 再被用会有问题
draft 只在这次 set 的回调执行期间有效，不能在回调外保存、复用。
2. set(obj) 不会走 draft
set({ activeConversation: conv });  // 普通替换，不经过 Immerset((state) => { state.activeConversation = conv; });  // 走 Immer draft
传对象：Zustand 照常做合并/替换，Immer 不会处理。
传函数：Immer 提供 draft，你「直接改」的其实是代理，最终会生成新的不可变 state。
小结
可以用 set(obj)，也能用 set(fn)。
想用 Immer 的可变式写法（state.xxx = yyy），必须用 set((state) => { ... })。
本项目里的 setActiveConversation、replyToMessage 用 set({ ... }) 没问题，因为更新简单；复杂嵌套更新（如 sendMessage）才用 set(fn) + draft。
作用范围	整个 store
set(obj)	不经过 Immer，直接更新
set(fn)	state 是整体 state 的 draft，可随便改
是的，整个 store 都会使用 Immer。
作用范围
immer((set, get) => ({ ... })) 包住的是整个 store 的创建函数，所以：
所有通过 set 做的更新都会经过 Immer
用 set((state) => { ... }) 时，传入的 state 始终是当前整个 store 的 draft
不管是 sendMessage、addReaction 还是 clearUnread，只要用 set(fn)，回调里的 state 都是同一个 draft
可以这样理解
immer(  ← 包住整个 store  (set, get) => ({    friends: [...],    messagesByConv: {...},    sendMessage: () => set((state) => { state.messagesByConv[key] = [...] }),  // state 是整个 store    clearUnread: () => set((state) => { state.friends.find(...).unreadCount = 0 }),  // 同一个 state  }))
也就是说：不是只有某几个字段生效，而是整个 store 的 state 在 set(fn) 里都是 Immer draft。
总结
项目	说明
作用范围	整个 store
set(obj)	不经过 Immer，直接更新
set(fn)	state 是整体 state 的 draft，可随便改

 */
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Message } from "@/sdk";
import type { Friend, Group } from "@/lib/chatSessionMock";
import {
  MOCK_FRIENDS,
  MOCK_GROUPS,
  CURRENT_USER_ID,
  getMessagesForConversation,
  getConversationKey,
} from "@/lib/chatSessionMock";
import { MessageType, MessageStatus, SenderType } from "@/sdk";

export type ConversationType = "c2c" | "group";

export interface ActiveConversation {
  type: ConversationType;
  id: string;
  name: string;
}

interface ChatSessionState {
  // ---------- 会话列表：侧边栏 + 当前选中 ----------
  friends: Friend[];
  groups: Group[];
  activeConversation: ActiveConversation | null; // 当前 c2c 或 group 会话

  // ---------- 消息：多会话按 key 分桶 ----------
  /** conversationKey -> messages，key 为 getConversationKey('c2c', id) 或 groupId */
  messagesByConv: Record<string, Message[]>;

  // ---------- 输入中 / 在线：单聊与群聊结构不同 ----------
  /** c2c：userId -> isTyping */
  typingByUser: Record<string, boolean>;
  /** group：groupId -> userId[] 正在输入的成员 */
  typingByGroup: Record<string, string[]>;
  /** userId -> 是否在线 */
  onlineByUser: Record<string, boolean>;

  /** 引用回复目标，点击「回复」时设置 */
  quoteTarget: Message | null;
  /** 滚动/聚焦信号，replyToMessage 时更新 */
  scrollToInputRequest: number;

  setActiveConversation: (conv: ActiveConversation | null) => void;
  selectFriend: (friend: Friend) => void;
  selectGroup: (group: Group) => void;
  getMessagesForActive: () => Message[];
  sendMessage: (content: string) => void;
  sendImage: (file: File) => void;
  sendVideo: (file: File) => void;
  sendSticker: (stickerId: string) => void;
  setTyping: (userId: string, isTyping: boolean, groupId?: string) => void;
  setOnline: (userId: string, online: boolean) => void;
  clearUnread: (type: ConversationType, id: string) => void;
  editMessage: (messageId: string, newContent: string) => void;
  recallMessage: (messageId: string) => void;
  /** 点击回复：设置引用目标并请求滚动/聚焦输入框 */
  replyToMessage: (msg: Message) => void;
  setQuoteTarget: (msg: Message | null) => void;
  addReaction: (messageId: string, emoji: string) => void;
  removeReaction: (messageId: string, emoji: string) => void;
}

function buildInitialMessages(): Record<string, Message[]> {
  const out: Record<string, Message[]> = {};
  MOCK_FRIENDS.forEach((f) => {
    out[getConversationKey("c2c", f.id)] = getMessagesForConversation(
      getConversationKey("c2c", f.id)
    );
  });
  MOCK_GROUPS.forEach((g) => {
    out[g.id] = getMessagesForConversation(g.id);
  });
  return out;
}

export const useChatSessionStore = create<ChatSessionState>()(
  immer((set, get) => ({
    // 下文 set((state) => { state.xxx = yyy }) 中的 state 为 Immer draft，可写式更新
    // ---------- 状态（Mock 初始化，无 WebSocket） ----------
    friends: MOCK_FRIENDS,
    groups: MOCK_GROUPS,
    activeConversation: null,
    messagesByConv: buildInitialMessages(),
    typingByUser: {},
    typingByGroup: {},
    onlineByUser: Object.fromEntries(MOCK_FRIENDS.map((f) => [f.id, f.online])),
    quoteTarget: null,
    scrollToInputRequest: 0,

    setActiveConversation: (conv) => set({ activeConversation: conv }),

    replyToMessage: (msg) =>
      set({ quoteTarget: msg, scrollToInputRequest: Date.now() }),
    setQuoteTarget: (msg) => set({ quoteTarget: msg }),

    selectFriend: (friend) => {
      set({
        activeConversation: { type: "c2c", id: friend.id, name: friend.name },
      });
      get().clearUnread("c2c", friend.id);
    },

    selectGroup: (group) => {
      set({
        activeConversation: { type: "group", id: group.id, name: group.name },
      });
      get().clearUnread("group", group.id);
    },

    getMessagesForActive: () => {
      const { activeConversation, messagesByConv } = get();
      if (!activeConversation) return [];
      const key =
        activeConversation.type === "c2c"
          ? getConversationKey("c2c", activeConversation.id)
          : activeConversation.id;
      return [...(messagesByConv[key] ?? [])].sort(
        (a, b) => (a.seqId ?? a.timestamp) - (b.seqId ?? b.timestamp)
      );
    },

    sendMessage: (content) => {
      const { activeConversation, messagesByConv, quoteTarget } = get();
      if (!activeConversation || !content.trim()) return;
      const key =
        activeConversation.type === "c2c"
          ? getConversationKey("c2c", activeConversation.id)
          : activeConversation.id;
      set((state) => {
        // state 为 Immer draft，直接修改等价于不可变更新
        const list = state.messagesByConv[key] ?? [];
        const maxSeq = Math.max(0, ...list.map((m) => m.seqId ?? 0));
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
        const msg: Message = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conversationId: key,
          content: content.trim(),
          type: MessageType.TEXT,
          status: MessageStatus.READ,
          senderType: SenderType.USER,
          senderId: CURRENT_USER_ID,
          senderName: "Me",
          timestamp: Date.now(),
          seqId: maxSeq + 1,
          metadata,
        };
        state.messagesByConv[key] = [...list, msg];
        state.quoteTarget = null;
      });
    },

    sendImage: (file) => {
      const { activeConversation } = get();
      if (!activeConversation) return;
      // File 或 Blob 对象（比如通过 <input type="file"> 选中的文件）
      // 返回：形如 blob:http://localhost:3000/xxx-xxx-xxx 的 URL
      // 本质：这个 URL 指向浏览器内存中的文件数据，而不是服务器上的路径
      const url = URL.createObjectURL(file);
      console.log("[sendImage] createObjectURL:", url, "file:", {
        name: file.name,
        type: file.type,
        size: file.size,
      });
      const key =
        activeConversation.type === "c2c"
          ? getConversationKey("c2c", activeConversation.id)
          : activeConversation.id;
      set((state) => {
        // 部分旧消息可能没有 seqId（例如 Mock 数据），用 ?? 0 避免 Math.max 得到 NaN。
        const list = state.messagesByConv[key] ?? [];
        const maxSeq = Math.max(0, ...list.map((m) => m.seqId ?? 0));
        const msg: Message = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conversationId: key,
          // 图片/视频的 blob URL 作为 content
          //           把文件转成 blob URL
          // 把这个 URL 存进消息的 content
          // 渲染时用 <img src={msg.content}> 等显示
          //           blob URL 指向当前浏览器内存里的数据
          // 只对当前页面有效，刷新或换设备就失效
          // 服务端和其他客户端拿不到这个 URL 对应的资源
          // 必须上传到 CDN/对象存储，再用服务端返回的 URL 作为消息内容
          content: url,
          type: MessageType.IMAGE,
          status: MessageStatus.READ,
          senderType: SenderType.USER,
          senderId: CURRENT_USER_ID,
          senderName: "Me",
          timestamp: Date.now(),
          seqId: maxSeq + 1,
        };
        state.messagesByConv[key] = [...list, msg];
      });
    },

    sendVideo: (file) => {
      const { activeConversation } = get();
      if (!activeConversation) return;
      const url = URL.createObjectURL(file);
      console.log("[sendVideo] createObjectURL:", url, "file:", {
        name: file.name,
        type: file.type,
        size: file.size,
      });
      const key =
        activeConversation.type === "c2c"
          ? getConversationKey("c2c", activeConversation.id)
          : activeConversation.id;
      set((state) => {
        const list = state.messagesByConv[key] ?? [];
        const maxSeq = Math.max(0, ...list.map((m) => m.seqId ?? 0));
        const msg: Message = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conversationId: key,
          content: url,
          type: MessageType.VIDEO,
          status: MessageStatus.READ,
          senderType: SenderType.USER,
          senderId: CURRENT_USER_ID,
          senderName: "Me",
          timestamp: Date.now(),
          seqId: maxSeq + 1,
          metadata: { fileName: file.name, fileSize: file.size },
        };
        state.messagesByConv[key] = [...list, msg];
      });
    },

    sendSticker: (stickerId) => {
      const { activeConversation } = get();
      if (!activeConversation) return;
      const key =
        activeConversation.type === "c2c"
          ? getConversationKey("c2c", activeConversation.id)
          : activeConversation.id;
      set((state) => {
        const list = state.messagesByConv[key] ?? [];
        const maxSeq = Math.max(0, ...list.map((m) => m.seqId ?? 0));
        const msg: Message = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conversationId: key,
          content: stickerId,
          type: MessageType.STICKER,
          status: MessageStatus.READ,
          senderType: SenderType.USER,
          senderId: CURRENT_USER_ID,
          senderName: "Me",
          timestamp: Date.now(),
          seqId: maxSeq + 1,
        };
        state.messagesByConv[key] = [...list, msg];
      });
    },

    setTyping: (userId, isTyping, groupId) => {
      if (groupId) {
        set((state) => {
          const arr = state.typingByGroup[groupId] ?? [];
          const next = isTyping
            ? [...new Set([...arr, userId])]
            : arr.filter((u) => u !== userId);
          state.typingByGroup[groupId] = next;
        });
      } else {
        set((state) => {
          state.typingByUser[userId] = isTyping;
        });
      }
    },

    setOnline: (userId, online) => {
      set((state) => {
        state.onlineByUser[userId] = online;
      });
    },

    clearUnread: (type, id) => {
      //  state 是 Immer 代理
      // 对 draft 的修改会被记录
      // 回调结束后 Immer 会生成新的不可变 state
      // set((state) => ({
      //   ...state,
      //   onlineByUser: { ...state.onlineByUser, [userId]: online },
      // }));
      // // 或
      // set((state) => ({
      //   ...state,
      //   friends: state.friends.map((f) =>
      //     f.id === id ? { ...f, unreadCount: 0 } : f
      //   ),
      // }));
      if (type === "c2c") {
        set((state) => {
          const f = state.friends.find((x) => x.id === id);
          // 直接改 draft 里的对象
          if (f) f.unreadCount = 0;
        });
      } else {
        set((state) => {
          const g = state.groups.find((x) => x.id === id);
          if (g) g.unreadCount = 0;
        });
      }
    },

    editMessage: (messageId, newContent) => {
      if (!newContent.trim()) return;
      const { activeConversation } = get();
      if (!activeConversation) return;
      const key =
        activeConversation.type === "c2c"
          ? getConversationKey("c2c", activeConversation.id)
          : activeConversation.id;
      set((state) => {
        const list = state.messagesByConv[key] ?? [];
        const m = list.find(
          (x) =>
            x.id === messageId &&
            x.senderId === CURRENT_USER_ID &&
            x.type === MessageType.TEXT
        );
        if (m) m.content = newContent.trim();
      });
    },

    recallMessage: (messageId) => {
      const { activeConversation } = get();
      if (!activeConversation) return;
      const key =
        activeConversation.type === "c2c"
          ? getConversationKey("c2c", activeConversation.id)
          : activeConversation.id;
      set((state) => {
        const list = state.messagesByConv[key] ?? [];
        const m = list.find(
          (x) => x.id === messageId && x.senderId === CURRENT_USER_ID
        );
        if (m) {
          m.content = "已撤回";
          m.type = MessageType.TEXT;
          const meta = (m.metadata as Record<string, unknown>) ?? {};
          meta.recalled = true;
          m.metadata = meta;
        }
      });
    },

    addReaction: (messageId, emoji) => {
      const { activeConversation } = get();
      if (!activeConversation) return;
      const key =
        activeConversation.type === "c2c"
          ? getConversationKey("c2c", activeConversation.id)
          : activeConversation.id;
      set((state) => {
        const list = state.messagesByConv[key] ?? [];
        const m = list.find((x) => x.id === messageId);
        if (!m) return;
        const meta =
          (m.metadata as { reactions?: Record<string, string[]> }) ?? {};
        if (!meta.reactions) meta.reactions = {};
        if (!meta.reactions[emoji]) meta.reactions[emoji] = [];
        meta.reactions[emoji] = meta.reactions[emoji].filter(
          (u) => u !== CURRENT_USER_ID
        );
        meta.reactions[emoji].push(CURRENT_USER_ID);
        m.metadata = meta;
      });
    },

    removeReaction: (messageId, emoji) => {
      const { activeConversation } = get();
      if (!activeConversation) return;
      const key =
        activeConversation.type === "c2c"
          ? getConversationKey("c2c", activeConversation.id)
          : activeConversation.id;
      set((state) => {
        const list = state.messagesByConv[key] ?? [];
        const m = list.find((x) => x.id === messageId);
        if (!m) return;
        const meta =
          (m.metadata as { reactions?: Record<string, string[]> }) ?? {};
        if (!meta.reactions?.[emoji]) return;
        meta.reactions[emoji] = meta.reactions[emoji].filter(
          (u) => u !== CURRENT_USER_ID
        );
        if (meta.reactions[emoji].length === 0) delete meta.reactions[emoji];
        m.metadata = meta;
      });
    },
  }))
);
