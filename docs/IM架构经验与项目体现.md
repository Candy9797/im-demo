# IM 0→1 架构经验 & 本项目的知识体现

本文档梳理从零搭建即时通讯 (IM) 所需的核心知识领域、构建细节，以及在本 Web3 IM 客服项目中的具体体现。

---

## 〇、IM 0→1 构建清单（按优先级）

| 阶段 | 模块 | 必须能力 | 本项目 |
|------|------|----------|--------|
| **P0** | 连接 | WebSocket 长连接、Token 认证、重连、心跳 | ✅ |
| **P0** | 协议 | 帧结构、消息收发帧、ACK | ✅ |
| **P0** | 消息 | 文本发送/接收、乐观更新、状态流转 | ✅ |
| **P0** | 持久化 | 服务端落库、客户端离线存储 | ✅ |
| **P0** | 认证 | 用户身份、连接绑定 | ✅ |
| **P1** | 会话 | 会话模型、历史拉取、分页 | ✅ |
| **P1** | 投递 | 失败重试、去重、顺序保证 | ✅ |
| **P1** | 富媒体 | 图片/文件上传、富文本、Emoji | ✅ |
| **P1** | 实时体验 | 正在输入、连接状态、滚动行为 | ✅ |
| **P2** | 扩展 | 批处理、限流、虚拟化渲染 | ✅ |
| **P2** | 进阶 | 已读回执、引用回复、消息反应、贴纸 | ✅ |

---

## 一、IM 架构知识图谱

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        IM 0→1 所需知识体系                                │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────────────┤
│ 连接与传输   │ 消息协议     │ 会话模型     │ 消息持久化   │ 身份与认证       │
├─────────────┼─────────────┼─────────────┼─────────────┼─────────────────┤
│ 高频与扩展   │ 消息投递     │ 富媒体       │ 实时体验     │ 可靠性设计       │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────────────┘
```

---

## 二、0→1 构建路线图（实现顺序建议）

```
第 1 周：连接 + 协议 + 最简消息
├── WebSocket 连接、Token 认证
├── 帧结构、send_message / message / message_ack
├── 服务端 SQLite 落库
└── 客户端展示文本消息、乐观更新

第 2 周：持久化 + 会话
├── IndexedDB 离线存储
├── auth_ok 拉历史、SYNC 增量同步
├── 会话模型（单聊/多会话）
└── 重连、心跳、断线恢复

第 3 周：投递 + 体验
├── 失败重试、去重、顺序保证
├── 正在输入、连接状态
├── 历史分页、滚动行为
└── 富文本、图片、文件上传

第 4 周：扩展 + 进阶
├── 批处理、限流、虚拟化
├── 已读回执、引用回复
├── 消息反应、贴纸
└── 未读计数、搜索
```

---

## 三、各知识领域及项目体现

### 1. 连接与传输 (Connection & Transport)

**构建要点**：选型（WS vs 长轮询）、连接生命周期、断线检测与重连、认证方式、资源清理。

| 知识点 | 说明 | 本项目体现 |
|--------|------|------------|
| WebSocket 选型 | 双向、低延迟、长连接 | 使用原生 WebSocket，`WebSocketManager.ts` |
| 连接状态机 | 断开→连接中→已连接→重连中 | `ConnectionState.DISCONNECTED/CONNECTING/CONNECTED/RECONNECTING` |
| 重连策略 | 指数退避 + 随机抖动，避免惊群 | `scheduleReconnect()`: `baseInterval * 2^count + random`，上限 30s |
| 心跳保活 | 检测连接存活，及时发现断线 | `HEARTBEAT_PING/PONG`，默认 30s 间隔 |
| Token 传递 | 认证信息在建立连接时带入 | URL `?token=xxx`，服务端 `handleConnection` 解析 |
| 断开清理 | 释放服务端资源 | `ws.on("close")` 时从 `connsByUser` 移除 |

**核心代码**: `WebSocketManager.ts`, `server/index.ts` (wss)

---

### 2. 消息协议 (Message Protocol)

**构建要点**：统一帧格式、帧类型枚举、会话内 seq 保证顺序、clientMsgId 支持乐观更新与 ACK 回填。

| 知识点 | 说明 | 本项目体现 |
|--------|------|------------|
| 帧结构设计 | type + seq + timestamp + payload | `Frame` 接口，统一 JSON 序列化 |
| 序列号 (seq) | 保证顺序、去重、幂等 | 每帧带 seq，`nextSeq()` 单调递增 |
| 帧类型枚举 | 区分不同业务语义 | `FrameType`: send_message, message, message_ack, sync, ... |
| 客户端消息 ID | 乐观更新、ACK 匹配 | `clientMsgId` / `serverMsgId` 映射 |
| 会话级 seq_id | 消息在会话内的顺序 | `messages.seq_id`，`getMessagesAfter(convId, afterSeqId)` |

**核心代码**: `types.ts` (FrameType, Frame), `ws-handler.ts` (handleFrame)

---

### 3. 会话模型 (Conversation / Session Model)

**构建要点**：会话与消息的关系（1:N）、会话类型、切换时历史与新消息的归属、父子会话关联。

| 知识点 | 说明 | 本项目体现 |
|--------|------|------------|
| 单聊 vs 多会话 | 一个用户可有多个会话 | 双会话：Bot 会话 + Agent 会话 |
| 会话类型区分 | Bot / Human / Group | `session_type`: bot | agent |
| 会话切换 | 转人工时切换会话上下文 | `SESSION_SWITCHED` 帧，携带新 conversationId、历史消息 |
| 父子会话关联 | Bot→Agent 关联 | `parent_conv_id` 指向 Bot 会话 |
| 会话创建策略 | 复用 vs 新建 | `getOrCreateBotConversation` vs `createBotConversation`（fresh=1） |

**核心代码**: `db.ts` (conversations 表), `ws-handler.ts` (handleRequestAgent, assignAgent)

---

### 4. 消息持久化 (Message Persistence)

**构建要点**：服务端落库时机、客户端离线兜底、初始化/增量同步策略、批量写入与事务。

| 知识点 | 说明 | 本项目体现 |
|--------|------|------------|
| 服务端落库 | 消息写入 DB | SQLite `insertMessage` / `insertMessages` |
| 客户端离线存储 | 断网/刷新后恢复 | IndexedDB `saveMessage` / `getMessages` |
| 初始化同步 | 连接后拉取历史 | `auth_ok` 携带 `messages`，或 `getMessages(convId)` 从 IndexedDB 读 |
| 增量同步 | 按 seq 拉取缺失消息 | `SYNC` 帧 + `afterSeqId`，`getMessagesAfter(convId, afterSeqId)` |
| 历史分页 | 上滑加载更早消息 | `LOAD_HISTORY` + `getMessagesBefore` + `HISTORY_LOADED` |
| 批量写入优化 | 事务、prepared statement | `insertMessages` 单事务，IndexedDB 防抖批量写 |

**核心代码**: `db.ts`, `IndexedDBStore.ts`, `IMClient.ts` (onAuthOk, loadHistory, sync_response)

---

### 5. 身份与认证 (Identity & Auth)

**构建要点**：连接建立时的认证、Token 解析与校验、会话与连接的绑定、多种登录方式（钱包/访客）。

| 知识点 | 说明 | 本项目体现 |
|--------|------|------------|
| Token 认证 | JWT 或类似机制 | `verifyToken(token)`，解析 userId、address |
| 钱包签名 (SIWE) | Web3 登录 | `signInWithWallet`，nonce + 签名验证 |
| 访客模式 | 无需钱包即可体验 | `/api/auth/demo` 生成 guest token |
| 会话绑定 | Token 与连接绑定 | `connsByUser.set(userId, Map<connId, ConnEntry>)` |
| 代理转发 | 前端请求到同域 API | Next.js `/api/auth/demo` 代理到 127.0.0.1:3001 |

**核心代码**: `auth.ts`, `lib/siwe.ts`, `api/auth/demo/route.ts`

---

### 6. 高频与可扩展 (High QPS & Scalability)

**构建要点**：入站/出站批处理、去重窗口、限流、虚拟化渲染、批量 DB、WAL 模式。

| 知识点 | 说明 | 本项目体现 |
|--------|------|------------|
| 消息批处理 | 减少渲染、网络、DB 调用 | MessageQueue 入站 50ms 批量 flush，batchSize 30 |
| 去重 | 避免重复消息 | `seenIds` Map，5s 窗口，按 message.id |
| 限流 | 防止单用户压垮服务 | 每用户 20 条/秒，`checkRateLimit` |
| 虚拟化渲染 | 大列表只渲染可见项 | react-virtuoso，DOM 数量与视口相关 |
| 批量 DB 写入 | 降低事务次数 | `insertMessages` 用户消息 + Bot 回复同事务 |
| WAL 模式 | 读写并发 | SQLite `journal_mode = WAL` |

**核心代码**: `MessageQueue.ts`, `chatStore.ts` (MESSAGE_BATCH_RECEIVED), `ws-handler.ts` (checkRateLimit), `MessageList.tsx` (Virtuoso)

---

### 7. 消息投递 (Message Delivery)

**构建要点**：乐观更新、ACK 与 clientMsgId 匹配、状态流转、失败重试、离线队列。

| 知识点 | 说明 | 本项目体现 |
|--------|------|------------|
| 乐观更新 | 先展示再确认 | `sendMessage` 立即 push 到 conversation，emit MESSAGE_SENT |
| ACK 流程 | 服务端确认 → 更新状态 | `message_ack` 帧，clientMsgId→serverMsgId 回填 |
| 状态流转 | sending → sent → delivered → read | `MessageStatus` 枚举，StatusIcon 展示 |
| 失败重试 | 发送失败后重试 | MessageQueue 出站重试 3 次，指数退避 |
| 离线队列 | 断线期间缓存待发 | MessageQueue `pause`/`resume`，出站队列保留 |

**核心代码**: `IMClient.ts` (sendMessage, message_ack), `MessageQueue.ts`, `MessageItem.tsx` (StatusIcon)

---

### 8. 富媒体 (Rich Media)

**构建要点**：消息类型枚举、富文本解析与 XSS 防护、文件上传链路、选择器定位（Portal 防裁剪）。

| 知识点 | 说明 | 本项目体现 |
|--------|------|------------|
| 文本 | 基础消息类型 | `MessageType.TEXT` |
| 富文本 | Markdown 渲染 | `RichTextContent` + react-markdown，支持粗体、代码块、链接等 |
| 图片 | 上传、缩略图、大图 | `MessageType.IMAGE`，`FilePreview` 缩略图 + lightbox |
| 文件 | PDF 等 | `MessageType.PDF`，metadata 展示 |
| Emoji | 快捷输入 | `EmojiPicker` 组件，Portal 定位 |
| 贴纸 | 预设贴纸包 | `StickerPicker`，`MessageType.STICKER` |
| 上传流程 | 先传文件再发消息 | `sendFile` → fetch `/api/upload` → 消息 content 为 URL |

**核心代码**: `RichTextContent.tsx`, `FilePreview.tsx`, `InputArea.tsx`, `StickerPicker.tsx`, `upload.ts`

---

### 9. 实时体验 (Real-time UX)

**构建要点**：输入状态广播、连接/队列状态展示、滚动与 followOutput 策略、未读角标。

| 知识点 | 说明 | 本项目体现 |
|--------|------|------------|
| 输入状态 | 对方正在输入 | `TYPING_START` / `TYPING_STOP`，`TypingIndicator` |
| 连接状态 | 已连接/重连中/断开 | Header 显示 connectionState |
| 队列状态 | 排队位置、预计等待 | `QUEUE_STATUS` 帧，`QueueBanner` |
| 滚动行为 | 新消息自动到底部 | Virtuoso `followOutput`，仅当用户已在底部时滚动 |
| 回到底部按钮 | 用户上滑后可快速回底 | `atBottomStateChange`，`scrollToBottom` |
| 未读计数 | 红点角标、未读数 | `countUnread`，ChatTrigger/minimized 展示 |

**核心代码**: `TypingIndicator.tsx`, `QueueBanner.tsx`, `MessageList.tsx`, `Header.tsx`, `chatStore.ts` (countUnread)

---

### 10. 可靠性设计 (Reliability)

**构建要点**：去重、顺序、断线恢复、背压、DB 并发。

| 知识点 | 说明 | 本项目体现 |
|--------|------|------------|
| 消息去重 | 网络重试导致重复 | MessageQueue `seenIds`，IndexedDB 按 id put |
| 顺序保证 | 消息按 seq 展示 | `seq_id` 排序，`getMessagesAfter` 按 seq 拉取 |
| 断线恢复 | 重连后补拉/本地恢复 | 重连后 auth 或 sync 拉历史；IndexedDB 本地恢复 |
| 背压 | 队列满时策略 | MessageQueue maxSize，满时丢弃最旧未发送 |
| DB 并发 | 写冲突处理 | SQLite busy_timeout 5s，WAL 模式 |
| 已读回执 | 查看后上报、多端同步 | `markAsRead` + IntersectionObserver，`READ_RECEIPT` 帧 |
| 引用回复 | 回复某条消息 | `metadata.quote`，`QuotePreview` + `MessageQuoteBlock` |
| 消息反应 | 对消息点赞/emoji | `metadata.reactions`，`MessageReactions` + Portal，乐观更新 |

**核心代码**: `MessageQueue.ts`, `IndexedDBStore.ts`, `db.ts`, `MessageReactions.tsx`, `MessageQuoteBlock.tsx`, `QuotePreview.tsx`

---

## 四、知识 → 代码映射速查

| 知识领域 | 主要文件 |
|----------|----------|
| 连接与传输 | `WebSocketManager.ts`, `server/index.ts` |
| 消息协议 | `types.ts`, `ws-handler.ts` |
| 会话模型 | `db.ts`, `ws-handler.ts`, `IMClient.ts` |
| 消息持久化 | `db.ts`, `IndexedDBStore.ts`, `IMClient.ts` |
| 身份认证 | `auth.ts`, `siwe.ts`, `api/auth/demo` |
| 高频扩展 | `MessageQueue.ts`, `chatStore.ts`, `ws-handler.ts`, `MessageList.tsx` |
| 消息投递 | `IMClient.ts`, `MessageQueue.ts`, `MessageItem.tsx` |
| 富媒体 | `RichTextContent.tsx`, `FilePreview.tsx`, `InputArea.tsx`, `upload.ts` |
| 实时体验 | `TypingIndicator.tsx`, `QueueBanner.tsx`, `MessageList.tsx` |
| 可靠性 | `MessageQueue.ts`, `IndexedDBStore.ts`, `db.ts` |

---

## 五、面试 / 简历可提炼的亮点

1. **自研 IM SDK**：EventEmitter + WebSocketManager + MessageQueue 分层，框架无关
2. **双会话模型**：Bot / Agent 独立会话，转人工时新建并切换
3. **0→1 全栈**：前端 Next.js + 自研 SDK，后端 Node + SQLite，WebSocket 协议自设计
4. **高频优化**：批处理、限流、虚拟化、批量 DB、IndexedDB 防抖
5. **离线与恢复**：IndexedDB 持久化，重连后本地/服务端双源恢复
6. **Web3 集成**：SIWE 登录 + 访客模式，客服场景的认证组合
7. **进阶能力**：已读回执、引用回复、消息反应、贴纸、未读计数、历史分页

---

## 六、代码中未体现的知识点（知识缺口）

以下 IM 常见能力在本项目中**尚未实现**，可作为扩展方向或面试时的「知道但未做」说明。

### 1. 连接与传输

| 知识点 | 说明 | 现状 |
|--------|------|------|
| WebSocket 降级 | WS 失败时 fallback 到长轮询 | 无，仅 WebSocket |
| 消息压缩 | per-message deflate、gzip | 无，纯 JSON |
| 二进制协议 | Protobuf、MessagePack | 无，仅 JSON |

### 2. 消息协议

| 知识点 | 说明 | 现状 |
|--------|------|------|
| 批量 ACK | 多条消息一次确认 | 无，单条 ACK |
| 消息编辑/撤回 | 修改或删除已发消息 | 无 |

### 3. 会话模型

| 知识点 | 说明 | 现状 |
|--------|------|------|
| 群聊 | 多对多会话 | 无，仅单聊 (Bot/Agent) |
| @ 提醒 | 群内 @ 某人 | 无 |
| 多端登录 | 同一用户多设备在线 | 无，kickOthers 时后连踢前连 |
| 踢线策略 | 同账号新登录踢掉旧连接 | 有 kickOthers，无多端并存 |

### 4. 消息持久化

| 知识点 | 说明 | 现状 |
|--------|------|------|
| 全文搜索 | 按关键词搜索消息 | 有 `searchMessages` HTTP API |
| 消息过期/留存策略 | 自动清理老消息 | 无 |

### 5. 身份与认证

| 知识点 | 说明 | 现状 |
|--------|------|------|
| Token 刷新 | JWT 快过期时静默续期 | 无，过期即需重新登录 |
| 会话过期 | 长时间无操作自动登出 | 无 |

### 6. 可扩展性

| 知识点 | 说明 | 现状 |
|--------|------|------|
| 多实例部署 | 多 WS 节点 + 负载均衡 | 单进程，connsByUser 内存存储 |
| Redis 限流 | 跨实例共享限流计数 | 无，内存 `rateLimitMap` |
| 消息队列 | Kafka/RabbitMQ 异步处理 | 无，同步处理 |

### 7. 消息投递

| 知识点 | 说明 | 现状 |
|--------|------|------|
| 离线推送 | 用户不在线时 Push 通知 | 无 |
| 离线待发队列持久化 | 断网时待发消息存 IndexedDB，刷新不丢 | 无，MessageQueue 出站队列仅内存，刷新丢失 |
| 消息 TTL/过期 | 临时消息自动失效 | 无 |

### 8. 富媒体

| 知识点 | 说明 | 现状 |
|--------|------|------|
| 语音/视频消息 | 录制、转码、播放 | 无 |

### 9. 实时体验

| 知识点 | 说明 | 现状 |
|--------|------|------|
| 联系人在线状态 | 好友在线/离线/最后活跃 | 有 PRESENCE_UPDATE，仅在线列表 |
| 已读未读列表 | 群消息谁已读 | 无，仅单聊 readBy |

### 10. 可靠性

| 知识点 | 说明 | 现状 |
|--------|------|------|
| 端到端加密 | E2EE，服务端不解密 | 无 |
| 冲突解决 | 多端同时编辑，CRDT 等 | 无 |

---

## 七、进阶扩展（可作为实现方向）

| 知识领域 | 进阶点 | 实现思路 |
|----------|--------|----------|
| 连接 | 多端登录、踢线 | 服务端维护 userId→[ws] 映射，冲突策略 |
| 协议 | 批量 ACK、压缩 | 帧结构支持 messages[]，gzip/brotli |
| 会话 | 群聊、@提醒 | 新增 session_type=group，消息 metadata 存 mentions |
| 持久化 | 分页拉取历史 | `getMessagesBefore(convId, beforeSeqId, limit)` |
| 扩展 | 多实例、Redis | 限流/会话存 Redis，WS 层水平扩展 |
| 投递 | 已读回执 | READ 状态、已读时间戳、多端同步 |
