# 智能客服 IM - 功能说明

本文说明「智能客服」场景下的 IM 能力：Bot 阶段、转人工排队、Agent 对话、连接与认证、消息状态、输入与富媒体、正在输入、未读与持久化等。

---

## 一、功能概述

- **入口**：首页（`/`）右下角「Help & Support」浮窗，点击后打开聊天窗口。
- **阶段**：**Bot**（FAQ、关键词回复）→ **排队**（QUEUING，位置与预估等待）→ **人工**（AGENT，分配客服信息、全功能聊天）→ **已结束**（CLOSED）。
- **连接**：WebSocket 长连接（端口 3001），支持心跳、断线重连、可见性/网络恢复。
- **认证**：访客登录（connectAsGuest）或钱包登录（connectWallet + SIWE），登录后可 initialize 建立连接并拉取/同步消息。

---

## 二、入口与 UI 结构

| 区域 | 组件 | 说明 |
|------|------|------|
| 浮窗触发 | `ChatTrigger` | 未打开时显示按钮 + 未读数角标；点击后请求登录（若无 auth）并打开窗口 |
| 主窗口 | `ChatWindow` | Header、QueueBanner、MessageList、SmartAssistant、InputArea、Toast；支持最小化/展开 |
| 未登录 | `SmartAssistant` | FAQ 列表、转人工入口 |
| 已登录 | `MessageList` | 消息列表（Virtuoso 虚拟化）、历史分页、回到底部、引用/回复/撤回/编辑 |
| 输入区 | `InputArea` | 文本、表情、贴纸、图片/文件上传、按住说话、草稿恢复 |
| 对方正在输入 | `TypingIndicator` | Bot/Agent 正在输入时显示动画点点与名称 |

窗口开关与最小化状态在客户端挂载后从 `sessionStorage` 恢复，避免 SSR hydration 不一致（见 store 的 `rehydrateChatWindowState`）。

---

## 三、会话阶段（phase）

| 阶段 | 含义 | 典型 UI |
|------|------|---------|
| BOT | 与 Bot 对话 | FAQ、关键词回复、转人工按钮 |
| QUEUING | 排队等人工 | QueueBanner 显示位置、预估等待时间 |
| AGENT | 已分配人工客服 | Agent 信息、完整聊天能力 |
| CLOSED | 会话结束 | 可新建会话 |

阶段由服务端通过 WebSocket 推送（如 PHASE_CHANGED）或本地转人工请求后更新；store 中为 `phase: ConversationPhase`。

---

## 四、连接与认证

- **连接状态**：`connectionState` 为 CONNECTED / DISCONNECTED / RECONNECTING，Header 等处展示。
- **认证**：`auth` 含 token、userId、address；未登录时无法 initialize；KICKED 时清空 auth 与 client。
- **心跳与重连**：WebSocketManager 内 Ping/Pong 超时、指数退避重连、页面可见性/网络恢复时重连。
- **初始化**：ChatWindow 在 `isOpen` 且无 client 时调用 `initialize()`，建立连接、注册事件（MESSAGE_*、PHASE_CHANGED、TYPING_* 等），并拉取历史或同步。

---

## 五、消息与状态

- **消息列表**：`messages` 按 seqId/timestamp 排序；单条/批量接收（MESSAGE_RECEIVED、MESSAGE_BATCH_RECEIVED）时 push 到 store，发送时 MESSAGE_SENT 乐观更新。
- **状态流转**：sending → sent → delivered → read；服务端 ACK 通过 MESSAGE_STATUS_UPDATE 更新 status/seqId。
- **编辑与撤回**：editMessage、recallMessage；撤回失败时 showToast 并可选回滚（recall_expired）。
- **引用回复**：quoteTarget、replyToMessage；发送时 metadata 带引用信息。
- **反应**：addReaction、removeReaction，metadata.reactions 结构。

消息在 push 进 store 时使用 `{ ...message }` 拷贝，避免与 Immer 冻结后的 state 共享引用。

---

## 六、输入与富媒体

- **文本**：sendMessage(content)；支持引用回复。
- **表情/贴纸**：EmojiPicker、StickerPicker；sendSticker(stickerId)。
- **图片/文件**：sendFile(file)；上传后以 URL 或 blob 形式存 content，类型为 image/pdf 等。
- **按住说话**：HoldToTalkButton，语音识别结果填入输入框或发送（见 [按住说话-语音输入技术说明.md](./按住说话-语音输入技术说明.md)）。
- **草稿**：未发送内容存 IndexedDB，恢复时提示「已恢复未发送内容」（见 [未发送内容草稿存储-技术方案.md](./未发送内容草稿存储-技术方案.md)）。

---

## 七、对方正在输入（Typing）

- **数据**：store 中 `typing: { isTyping, senderType }`，由服务端 TYPING_START / TYPING_STOP 更新。
- **展示**：TypingIndicator 在 `typing.isTyping` 时显示 Bot/Agent 名称与点点动画。
- **设计**：typing 由服务端推送，客户端只负责展示。

---

## 八、未读与角标

- **未读数**：`countUnread(messages, userId)`：来自 Bot/Agent 且 status !== read 的消息数。
- **展示**：ChatTrigger 与最小化栏上的 unread-badge；进入会话后可 markAsRead(messageIds)。

---

## 九、持久化（IndexedDB）

- **范围**：chatStore 使用 persist 中间件，仅持久化 `messages`、`conversationId`（partialize），写入 IndexedDB（chatPersistStorage）。
- **合并**：恢复时按 max seqId 合并，避免旧数据覆盖新数据。
- **草稿**：客服输入框草稿使用独立库 `im-demo-drafts`（见未发送内容草稿存储文档）。

---

## 十、模拟对方连发（演示）

- **入口**：聊天窗口打开且已登录时，Header 下方有「条数输入框 + 模拟对方连发」按钮。
- **行为**：`simulateIncomingMessages(count)` 在本地向当前会话追加 N 条对方消息（Bot 或 Agent 身份），不经过 WebSocket，用于压测/演示虚拟列表与滚动。

---

## 十一、相关文件

| 类型 | 路径 |
|------|------|
| Store | `src/store/chatStore.ts` |
| 窗口/触发 | `src/components/ChatWindow.tsx`、`src/components/ChatWidget.tsx` |
| 消息列表/输入 | `src/components/MessageList.tsx`、`src/components/InputArea.tsx` |
| 智能助手/排队/正在输入 | `src/components/SmartAssistant.tsx`、`src/components/QueueBanner.tsx`、`src/components/TypingIndicator.tsx` |
| SDK | `src/sdk/IMClient.ts`、`src/sdk/WebSocketManager.ts`、`src/sdk/MessageQueue.ts` |
| 持久化 | `src/lib/chatPersistStorage.ts` |

更多状态与 UI 映射见 `src/store/README.md` 与 `docs/chatStore状态与UI映射.md`（若有）。
