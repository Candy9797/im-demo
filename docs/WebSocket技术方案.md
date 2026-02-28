# WebSocket 技术方案

本文档描述项目中 WebSocket 的架构、协议、使用方式及扩展方向。

---

## 一、概述

### 1.1 使用场景

| 场景 | 使用 WebSocket | 说明 |
|------|----------------|------|
| **客服 IM（Help & Support）** | ✅ 是 | 弹窗聊天，Bot/Agent 实时消息 |
| **会话页面（/chat 好友/群组）** | ❌ 否 | 当前为 Mock 数据，无长连接 |

### 1.2 技术栈

- **客户端**：原生 `WebSocket` API，`WebSocketManager` 封装
- **服务端**：`ws` 库，Express 同端口挂载 `/ws`
- **认证**：JWT token 通过 URL query 传递（`?token=xxx`）
- **协议**：JSON 文本帧，`{ type, seq, timestamp, payload }`

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Next.js (port 3000)                          │
│                                                                       │
│   chatStore.initialize()                                              │
│        │                                                              │
│        ├─ connectAsGuest() / connectWallet()                          │
│        │       │                                                      │
│        └─ createIMClient({ url: wsUrl, token, ... })                  │
│                  │                                                    │
│                  ▼                                                    │
│   IMClient ──────┬────── WebSocketManager ────── new WebSocket(url)   │
│        │         │              │                                      │
│        │         └── MessageQueue (入站批处理)                          │
│        │                                                              │
│        └── EventEmitter (SDKEvent) ─── chatStore 订阅 ─── UI 更新      │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ WebSocket
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     IM Server (port 3001)                             │
│                                                                       │
│   ws-handler.handleConnection(ws, token)                              │
│        │                                                              │
│        ├─ verifyToken(token) → auth                                   │
│        ├─ getOrCreateBotConversation / createBotConversation          │
│        ├─ send(AUTH_OK, { conversationId, messages, ... })            │
│        └─ ws.on('message') → handleFrame()                            │
│                  │                                                    │
│                  └── db.ts (SQLite)                                   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 三、客户端

### 3.1 WebSocketManager

**位置**：`src/sdk/WebSocketManager.ts`

**职责**：
- 建立、关闭 WebSocket 连接
- 发送帧：`send(type, payload)` → `ws.send(JSON.stringify(frame))`
- 接收帧：`onmessage` → `handleFrame(frame)` → `emit` 事件
- 心跳：每 30s 发送 `HEARTBEAT_PING`，等待 `HEARTBEAT_PONG`
- 重连：断线后指数退避重试（1s 起，最大 30s），最多 5 次

**配置**：

```typescript
interface ConnectionConfig {
  url: string;           // ws://host:3001/ws
  token?: string;        // JWT，拼接至 URL ?token=xxx
  userId: string;
  reconnectAttempts?: number;   // 默认 5
  reconnectInterval?: number;   // 基础间隔 1000ms
  heartbeatInterval?: number;   // 默认 30000ms
  apiBaseUrl?: string;   // HTTP API  base，用于文件上传等
  fresh?: boolean;       // true → URL 追加 &fresh=1，新建会话
}
```

**URL 构造**：
- 基础：`${url}?token=${encodeURIComponent(token)}`
- fresh：`&fresh=1` 表示新建 Bot 会话，不拉历史

**事件**：
- 内部通过 EventEmitter 向 IMClient 转发帧，如 `auth_ok`、`frame_in`、`message_ack` 等
- 连接状态：`SDKEvent.CONNECTED`、`DISCONNECTED`、`RECONNECTING`、`CONNECTION_ERROR`

### 3.2 IMClient 与 WebSocket 的关系

**位置**：`src/sdk/IMClient.ts`

IMClient 内部持有 `WebSocketManager`，不直接操作原生 WebSocket：

```typescript
this.wsManager = new WebSocketManager(config);

// 连接
this.wsManager.connect();

// 发送
this.wsManager.send(FrameType.SEND_MESSAGE, msg);
this.wsManager.send(FrameType.LOAD_HISTORY, { beforeSeqId });
this.wsManager.send(FrameType.ADD_REACTION, { messageId, emoji });

// 订阅
this.wsManager.on("auth_ok", onAuthOk);
this.wsManager.on("frame_in", ...);
this.wsManager.on("message_ack", ...);
```

**消息流**：
- **发消息**：`sendMessage()` → 乐观更新 → MessageQueue 出队 → `wsManager.send(SEND_MESSAGE, msg)`
- **收消息**：`frame_in` → MessageQueue 入队 → 批处理 flush → `emit(MESSAGE_RECEIVED)` / `MESSAGE_BATCH_RECEIVED`
- **ACK**：`message_ack` → 更新本地消息 id/status，同步 IndexedDB

---

## 四、服务端

### 4.1 ws-handler

**位置**：`server/ws-handler.ts`

**入口**：`handleConnection(ws, token, fresh?, kickOthers?)`

**连接流程**：
1. 无 token → 发送 `ERROR { code: "auth_required" }`，关闭
2. `verifyToken(token)` 失败 → 发送 `ERROR { code: "invalid_token" }`，关闭
3. 认证成功 → 根据 `fresh` 创建或复用 Bot 会话
4. `kickOthers` 为 true 时，关闭该用户其他连接，发送 `KICKED`
5. 注册 `ConnEntry` 到 `connsByUser`、`wsToConn`
6. 从 DB 拉取历史消息，发送 `AUTH_OK`
7. 广播 `PRESENCE_UPDATE`（在线列表）

**连接管理**：
- `connsByUser`: `Map<userId, Map<connId, ConnEntry>>`，支持多设备
- `wsToConn`: `WeakMap<WebSocket, ConnEntry>`，用于 onmessage 时查找
- 关闭时从 Map 移除，并再次广播 presence

**限流**：
- `RATE_LIMIT_MSGS_PER_SEC = 20`，滑动窗口 1 秒
- 超限返回 `ERROR { code: "rate_limit" }`

### 4.2 帧处理（handleFrame）

| 帧类型 | 处理逻辑 |
|--------|----------|
| `HEARTBEAT_PING` | 回复 `HEARTBEAT_PONG` |
| `LOAD_HISTORY` | 按 `beforeSeqId` 分页拉取，返回 `HISTORY_RESPONSE` |
| `MARK_READ` | 更新消息 status、metadata.readBy，广播 `READ_RECEIPT` |
| `ADD_REACTION` / `REMOVE_REACTION` | 更新 metadata.reactions，广播 `REACTION_UPDATE` |
| `SEND_MESSAGE` | 限流 → 入库 → ACK → Bot/Agent 回复或转人工 |
| `REQUEST_AGENT` | 创建 Agent 会话，模拟排队 → `SESSION_SWITCHED` |
| `SYNC` | 按 `afterSeqId` 拉取，返回 `sync_response` |

---

## 五、帧协议

### 5.1 帧结构

```typescript
interface Frame {
  type: FrameType;
  seq: number;
  timestamp: number;
  payload: unknown;
}
```

### 5.2 帧类型一览

**客户端 → 服务端**

| 类型 | 说明 | payload 示例 |
|------|------|--------------|
| `auth` | 预留，当前用 URL token | - |
| `send_message` | 发送消息 | `Message` |
| `ping` | 心跳 | `{ ts }` |
| `request_agent` | 转人工 | - |
| `sync` | 断线同步 | `{ afterSeqId }` |
| `load_history` | 加载更早历史 | `{ beforeSeqId }` |
| `mark_read` | 标记已读 | `{ messageIds }` |
| `add_reaction` | 添加反应 | `{ messageId, emoji }` |
| `remove_reaction` | 移除反应 | `{ messageId, emoji }` |

**服务端 → 客户端**

| 类型 | 说明 | payload 示例 |
|------|------|--------------|
| `auth_ok` | 连接成功 | `{ conversationId, phase, messages, hasMore }` |
| `message` | 新消息 | `Message & { seqId }` |
| `message_ack` | 消息确认 | `{ clientMsgId, serverMsgId, seqId }` |
| `pong` | 心跳响应 | `{ ts }` |
| `queue_status` | 排队状态 | `{ position, total, estimatedWait }` |
| `agent_info` | 客服信息 | `AgentInfo` |
| `phase_change` | 会话阶段变更 | `{ phase, ... }` |
| `sync_response` | 同步响应 | `{ messages }` |
| `session_switched` | 切换至 Agent 会话 | `{ conversationId, messages, agentInfo }` |
| `history_response` | 历史分页 | `{ messages, hasMore }` |
| `presence_update` | 在线列表 | `{ online: userId[] }` |
| `read_receipt` | 已读回执 | `{ messageIds, readBy }` |
| `reaction_update` | 反应更新 | `{ messageId, reactions, message }` |
| `kicked` | 被踢下线 | `{ reason }` |
| `error` | 错误 | `{ code, message }` |

---

## 六、连接与重连

### 6.1 连接流程

```
用户点击 Help & Support
    │
    ▼
chatStore.connectAsGuest() / connectWallet()
    │
    ▼
获取 token（demo 或 SIWE 签名）
    │
    ▼
createIMClient({ userId, token, url: wsUrl, apiBaseUrl, fresh? })
    │
    ▼
client.connect() → wsManager.connect()
    │
    ▼
new WebSocket(wsUrl + ?token=xxx[&fresh=1])
    │
    ├─ onopen → emit(CONNECTED) → startHeartbeat()
    │
    ▼
服务端 verifyToken → 发送 AUTH_OK
    │
    ▼
IMClient 收到 auth_ok → 启动 MessageQueue → resolve(connect)
```

### 6.2 心跳

- **间隔**：`heartbeatInterval`，默认 30 秒
- **发送**：`FrameType.HEARTBEAT_PING`，payload `{ ts: Date.now() }`
- **响应**：服务端回复 `HEARTBEAT_PONG`
- **超时**：当前实现未做 PONG 超时检测，依赖 `onclose` 触发重连

### 6.3 重连

- **触发**：`ws.onclose` 或 `ws.onerror` 后进入 `handleDisconnect`
- **策略**：指数退避 + 随机抖动
  - 延迟 = `min(baseInterval * 2^reconnectCount + random(0,1000), 30000)`
  - `reconnectCount` 从 0 递增，最大重试次数 5
- **状态**：`ConnectionState.RECONNECTING`，emit `SDKEvent.RECONNECTING`
- **成功**：`reconnectCount` 重置为 0
- **失败**：达到最大次数后 emit `DISCONNECTED`

---

## 七、chatStore 接入

**位置**：`src/store/chatStore.ts`

**初始化**（用户打开聊天弹窗时）：

```typescript
const wsUrl = `ws://${window.location.hostname}:3001/ws`;
const client = createIMClient({
  userId: auth.userId,
  token: auth.token,
  url: wsUrl,
  apiBaseUrl: apiBase,
  fresh: wantFreshStart,
});

client.connect().then(() => { /* ... */ });
```

**事件订阅**：`client.on(SDKEvent.XXX, handler)` 更新 Zustand 状态，驱动 UI。

---

## 八、扩展：chat 会话页接入 WebSocket

当前 `/chat` 使用 `chatSessionStore` + Mock 数据。若需实时好友/群聊，需：

### 8.1 协议扩展

- 新增帧类型：如 `send_c2c`、`send_group`、`c2c_message`、`group_message`
- 会话标识：`conversationKey = type === 'c2c' ? \`c2c-${friendId}\` : groupId`

### 8.2 服务端扩展

- 支持 C2C、群组会话类型
- 消息路由：C2C 点对点推送，群组广播给群成员
- 在线状态、输入中状态推送

### 8.3 客户端扩展

- `chatSessionStore` 中接入 IMClient 或新建 SessionIMClient
- `sendMessage` / `sendImage` / `sendSticker` 通过 WebSocket 发送，不再仅写本地
- 订阅 `MESSAGE_RECEIVED` 等事件，更新 `messagesByConv`
- 可选：为 chat 会话使用独立连接或复用现有 IMClient（需服务端支持多会话）

### 8.4 工作量估算

| 模块 | 工作内容 | 难度 |
|------|----------|------|
| 服务端 | C2C/群组会话模型、消息路由、在线状态 | 高 |
| 协议 | 新帧类型、payload 结构 | 中 |
| 客户端 | chatSessionStore 对接 SDK、消息同步 | 中 |
| 测试 | 多端同步、离线恢复、重连 | 高 |

---

## 九、文件清单

| 文件 | 说明 |
|------|------|
| `src/sdk/WebSocketManager.ts` | WebSocket 连接、收发、心跳、重连 |
| `src/sdk/IMClient.ts` | 业务封装，持有 WebSocketManager，消息队列 |
| `src/sdk/types.ts` | FrameType、Frame、ConnectionConfig |
| `src/store/chatStore.ts` | 创建 IMClient、订阅事件、更新 UI |
| `server/ws-handler.ts` | WebSocket 连接处理、帧分发、限流 |
| `server/index.ts` | 挂载 `/ws` 路由 |
| `server/auth.ts` | JWT 校验、SIWE |

---

## 十、运行与调试

```bash
npm run dev   # 3000 + 3001 同时启动
```

- WebSocket 地址：`ws://localhost:3001/ws`
- 连接时需带有效 token，可从 `/api/auth/demo` 获取（访客）或 SIWE 签名获取
- 控制台可看到 `[WebSocketManager] Reconnecting in ...` 等日志
