# store 状态管理说明

本目录下各 Store 的职责、状态划分、持久化、与 SDK/UI 的协作方式。

---

## 一、概览

| Store | 文件 | 场景 | 路由/入口 | 持久化 |
|-------|------|------|-----------|--------|
| **chatStore** | `chatStore.ts` | 客服 IM（Bot + 转人工 Agent） | `/`、Landing/ChatWidget | 是（IndexedDB，仅 messages + conversationId） |
| **chatSessionStore** | `chatSessionStore.ts` | 好友/群组聊天（Mock） | `/chat-session` | 否 |

两者**业务域不同、数据源不同**，因此拆成两个 Store，避免无关状态变化触发重渲染，路由与组件按需引入。

---

## 二、技术栈与中间件

- **Zustand**：`create()` 创建 Store，`useChatStore` / `useChatSessionStore` 在组件中订阅。
- **Immer**：`immer((set, get) => ({ ... }))` 包裹创建函数，`set((state) => { state.xxx = yyy })` 时传入的 `state` 为 **draft**，可写式更新，Immer 内部生成不可变 state。
- **Persist**（仅 chatStore）：`persist(..., { name, storage, partialize, merge })`，将部分状态持久化到 IndexedDB。

### Immer 使用要点

| 写法 | Immer 是否介入 | 说明 |
|------|----------------|------|
| `set({ x: 1 })` | 否 | 直接合并/替换，与普通 Zustand 一致 |
| `set((state) => { state.x = 1 })` | 是 | `state` 为整棵 store 的 draft，可直接改，Immer 生成新不可变 state |

- draft 仅在 `set` 回调内有效，不要在回调外保存引用。
- 复杂嵌套更新（如消息列表 push、去重）用 `set(fn)` + draft；简单字段用 `set({ ... })` 即可。

---

## 三、chatStore（客服 IM）

### 3.1 职责与数据流

- **职责**：客服对话场景的全局状态——认证、连接、单会话（Bot/排队/Agent）、消息列表、历史分页、输入中/在线、UI 弹窗与引用回复等。
- **数据流**：
  - **出站**：UI 调用 `sendMessage`、`requestAgent` 等 → Store action 调 `IMClient` → WebSocket 发出。
  - **入站**：`IMClient` 订阅 `SDKEvent`，在回调里 `set(...)` 更新 Store → 订阅该 state 的组件重渲染。
- **引用隔离**：从 IMClient/服务端拿到的消息在 push 进 `state.messages` 时用 `{ ...message }` 拷贝，避免与 Immer 冻结后的 state 共享引用。

### 3.2 状态分组

| 分类 | 字段 | 说明 | 更新来源 |
|------|------|------|----------|
| **认证** | `auth`, `authError`, `authConnecting` | 登录前置条件；未登录不执行 initialize | `connectWallet`, `connectAsGuest`, `KICKED` |
| **连接** | `client`, `connectionState` | IMClient 实例、连接状态 | `CONNECTED` / `DISCONNECTED` / `RECONNECTING` |
| **会话** | `conversationId`, `phase`, `agentInfo`, `queue`, `messages`, `faqItems` | 单会话：当前会话 ID、阶段、客服信息、排队、消息列表、FAQ | `MESSAGE_*`, `PHASE_CHANGED`, `AGENT_ASSIGNED`, `QUEUE_UPDATE`, `MESSAGES_RESET` 等 |
| **会话辅助** | `hasMoreHistory`, `loadingHistory`, `typing`, `onlineUsers` | 历史分页、输入中、在线人数 | `HISTORY_LOADED`, `loadMoreHistory`, `TYPING_*`, `PRESENCE_UPDATE` |
| **UI** | `isOpen`, `isMinimized`, `isExpanded`, `showWalletModal`, `wantFreshStart`, `searchResults`, `quoteTarget`, `scrollToInputRequest`, `toast`, `format` | 弹窗、引用回复、滚动信号、Toast、序列化格式等 | 对应 setter / action |

### 3.3 主要 Action 说明

| Action | 说明 |
|--------|------|
| `connectWallet()` | 钱包登录（SIWE），成功写 `auth`，失败写 `authError` |
| `connectAsGuest()` | 访客登录，请求 `/api/auth/demo`，写 `auth` / `authError` |
| `initialize()` | 已登录时：创建 IMClient、订阅全部 SDKEvent、`client.connect()`，连接成功后把 `client`、`conversationId`、`messages` 等同步到 Store |
| `sendMessage(content)` | 若有 `quoteTarget` 则带引用元数据；发完后清空 `quoteTarget`；内部 `client.sendMessage(...)` |
| `sendFile(file)` | 委托 `client.sendFile(file)` |
| `selectFAQ(faqId)` | 发 FAQ 选项；`faq-6` 走转人工 |
| `requestAgent()` | 转人工，`client.requestHumanAgent()` |
| `loadMoreHistory()` | 取当前 `messages` 最小 seq，`client.loadHistory(minSeq)`；设 `loadingHistory: true`，`HISTORY_LOADED` 或超时兜底清掉 |
| `markAsRead(messageIds)` | 乐观更新 status 为 read，再 `client.markAsRead(messageIds)` |
| `addReaction` / `removeReaction` | 乐观更新 `metadata.reactions`，再调 client 同步 |
| `editMessage` / `recallMessage` | 乐观更新内容/撤回态，再调 client；撤回失败时 `server_error` 回滚并 Toast |
| `searchMessages(query)` | HTTP 搜索，结果写 `searchResults` |
| `replyToMessage(msg)` | 设 `quoteTarget`、`scrollToInputRequest: Date.now()`，供 InputArea 滚动并聚焦 |
| `destroy()` | 断开 client、移除监听、重置 client/connectionState/messages 等，不删持久化 |

### 3.4 SDK 事件与 Store 更新对应关系

| SDKEvent | Store 侧处理 |
|----------|--------------|
| `CONNECTED` / `DISCONNECTED` / `RECONNECTING` | 更新 `connectionState` |
| `MESSAGE_SENT` / `MESSAGE_RECEIVED` | 按 id 去重后 `state.messages.push({ ...message })` |
| `MESSAGE_BATCH_RECEIVED` | 按 id 去重后批量 push |
| `MESSAGE_STATUS_UPDATE` | 找到对应消息更新 `status`、`seqId`、`metadata` |
| `MESSAGE_SEND_FAILED` | 对应消息 `status = 'failed'` |
| `PHASE_CHANGED` | 更新 `phase` |
| `MESSAGES_RESET` | 整表替换 `messages`（及可选 `conversationId`） |
| `AGENT_ASSIGNED` | 更新 `agentInfo`，`queue: null` |
| `QUEUE_UPDATE` | 更新 `queue` |
| `TYPING_START` / `TYPING_STOP` | 更新 `typing` |
| `HISTORY_LOADED` | 去重后 prepend，按 seqId/timestamp 排序，更新 `hasMoreHistory`、`loadingHistory` |
| `PRESENCE_UPDATE` | 更新 `onlineUsers` |
| `READ_RECEIPT` | 更新对应消息 `status`、`metadata.readBy` |
| `REACTION_UPDATE` | 按 messageId/clientMsgId 匹配，更新 `metadata.reactions` |
| `MESSAGE_EDIT` / `MESSAGE_RECALL` | 匹配消息后更新 content/撤回态 |
| `server_error` | 若为 `recall_expired` 则回滚撤回并 Toast |
| `KICKED` | 设 `authError`、`connectionState: DISCONNECTED` |

### 3.5 持久化（Persist）

- **存储**：`chatPersistStorage`（IndexedDB，库名 `web3-im-chat`），接口见 `src/lib/chatPersistStorage.ts`。
- **partialize**：只持久化 `messages`、`conversationId`。不持久化 `client`（不可序列化）、`auth`（敏感/过期）、连接/会话/UI 等运行时状态。
- **merge**：rehydration 时与当前内存 state 合并；对 `messages` 取「更完整」的一方（按 max seqId），避免离线期间 SYNC 补全后的新列表被旧 IndexedDB 快照覆盖。
- **防抖**：`chatPersistStorage.setItem` 内 80ms 防抖，减少频繁写入 IndexedDB。
- **getPersistedChatState**：rehydration 未完成时，IMClient 的 `getPersistedMessages` 会直接读 IndexedDB，用于 auth_ok 空消息时展示离线消息，减少空白时间。

---

## 四、chatSessionStore（好友/群组 Mock）

### 4.1 职责与数据流

- **场景**：好友/群组多会话、Mock 数据、无 WebSocket；用于 `/chat-session` 页面。
- **数据流**：纯本地；`sendMessage`、`sendImage` 等直接改 `messagesByConv`，无服务端同步。

### 4.2 状态分组

| 分类 | 字段 | 说明 |
|------|------|------|
| **会话列表** | `friends`, `groups`, `activeConversation` | 侧边栏数据 + 当前选中的 c2c/group |
| **消息** | `messagesByConv` | `conversationKey -> Message[]`，key 为 `getConversationKey('c2c', id)` 或 `groupId` |
| **输入/在线** | `typingByUser`, `typingByGroup`, `onlineByUser` | 单聊按 userId，群聊按 groupId 的输入中；userId 在线态 |
| **UI** | `quoteTarget`, `scrollToInputRequest` | 引用回复、滚动/聚焦信号 |

### 4.3 主要 Action

| Action | 说明 |
|--------|------|
| `setActiveConversation(conv)` | 设置当前会话（c2c 或 group） |
| `selectFriend(friend)` | 设为当前会话并 `clearUnread('c2c', friend.id)` |
| `selectGroup(group)` | 设为当前会话并 `clearUnread('group', group.id)` |
| `getMessagesForActive()` | 根据 `activeConversation` 从 `messagesByConv` 取列表并按 seqId/timestamp 排序（只读，不写 store） |
| `sendMessage(content)` | 当前会话 key 下 push 一条文本消息（含引用 metadata），清空 `quoteTarget` |
| `sendImage(file)` / `sendVideo(file)` | 创建 blob URL 作为 content，push 图片/视频消息（仅本地） |
| `sendSticker(stickerId)` | push 贴纸消息 |
| `setTyping(userId, isTyping, groupId?)` | 更新 `typingByUser` 或 `typingByGroup` |
| `setOnline(userId, online)` | 更新 `onlineByUser` |
| `clearUnread(type, id)` | 将对应 friend 或 group 的 `unreadCount` 置 0 |
| `editMessage` / `recallMessage` | 在当前会话消息列表中查找并更新内容/撤回态 |
| `replyToMessage(msg)` | 设 `quoteTarget`、`scrollToInputRequest` |
| `addReaction` / `removeReaction` | 更新对应消息的 `metadata.reactions` |

### 4.4 与 chatStore 的差异小结

| 项 | chatStore | chatSessionStore |
|----|-----------|------------------|
| 数据源 | WebSocket + IMClient，服务端同步 | Mock（`chatSessionMock`），仅本地 |
| 会话模型 | 单会话（当前 Bot/Agent） | 多会话（c2c/group），`messagesByConv` 分桶 |
| 持久化 | IndexedDB（messages + conversationId） | 无 |
| 认证 | auth + initialize + client | 无 |
| 连接状态 | connectionState、client | 无 |

---

## 五、使用建议

1. **按路由/页面选 Store**：客服入口用 `useChatStore`，好友/群组页用 `useChatSessionStore`，避免混用导致无关更新。
2. **按需订阅**：用 `useShallow` 或选择器只订阅用到的字段，减少重渲染，例如：
   - `useChatStore(useShallow(s => ({ connectionState: s.connectionState, messages: s.messages })))`
3. **消息引用**：从 Store 取出的 `messages` 为只读（Immer 冻结），不要直接修改；变更通过 action + `set` 完成。
4. **初始化顺序**：客服场景先 `connectWallet` 或 `connectAsGuest`，再 `initialize()`，否则 `initialize` 内会设 `authError` 并 return。

---

## 六、相关文件

| 文件 | 说明 |
|------|------|
| `chatStore.ts` | 客服 IM Store 实现 |
| `chatSessionStore.ts` | 好友/群组 Store 实现 |
| `src/lib/chatPersistStorage.ts` | chatStore 的 IndexedDB 存储引擎（防抖、getPersistedChatState） |
