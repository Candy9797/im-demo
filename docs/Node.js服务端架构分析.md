# Node.js 服务端架构分析

> 本项目的 Node.js 后端（`server/`）详细分析文档

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                     HTTP Server (Node.js createServer)                │
│  Express (REST)  +  ws (WebSocket path: /ws)                         │
└─────────────────────────────────────────────────────────────────────┘
        │                    │                    │
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  REST API    │   │ WebSocket Handler │   │  Static /uploads  │
│  auth/upload │   │  ws-handler.ts    │   │  express.static   │
│  search      │   │  实时消息、帧分发  │   │  文件服务         │
└──────────────┘   └──────────────────┘   └──────────────────┘
        │                    │
        ▼                    ▼
┌──────────────┐   ┌──────────────────┐
│   auth.ts    │   │     db.ts        │
│  SIWE / JWT  │   │  better-sqlite3  │
└──────────────┘   └──────────────────┘
        │                    │
        └────────┬───────────┘
                 ▼
        ┌──────────────────┐
        │     bot.ts       │
        │  FAQ / Agent 回复 │
        └──────────────────┘
```

---

## 二、技术栈

| 依赖 | 版本 | 用途 |
|------|------|------|
| express | ^5.2.1 | HTTP 框架，REST 路由 |
| ws | ^8.19.0 | WebSocket 服务端 |
| better-sqlite3 | ^12.6.2 | SQLite 数据库 |
| jsonwebtoken | ^9.0.3 | JWT 签发与验证 |
| siwe | ^3.0.0 | 钱包签名登录（SIWE） |
| multer | ^2.0.2 | 文件上传 |
| cors | ^2.8.6 | 跨域 |
| uuid | ^13.0.0 | 唯一 ID 生成 |

**运行**：`tsx server/index.ts`，端口 3001

---

## 三、模块详解

### 3.1 index.ts - 入口与路由

**职责**：创建 HTTP 服务、挂载 Express、挂载 WebSocket、注册 REST 路由。

**启动流程**：
1. `createServer(app)` 创建 HTTP 服务
2. `new WebSocketServer({ server, path: "/ws" })` 在 `/ws` 路径上处理 WebSocket 升级
3. `server.listen(3001)`

**REST 路由**：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/auth/nonce | 获取 SIWE nonce（需 address） |
| GET | /api/auth/demo | 访客登录，返回 token/userId/address |
| POST | /api/auth/verify | 验证 SIWE 签名，返回 JWT |
| GET | /api/search | 搜索消息（Bearer token，q、convId、limit） |
| POST | /api/upload | 上传文件（Bearer token，multer） |
| - | /uploads/* | 静态文件，express.static |

**WebSocket**：URL `ws://host:3001/ws?token=xxx&fresh=1&multi=1`
- `token`：JWT，必填
- `fresh=1`：新建 Bot 会话，不拉历史
- `multi=1`：允许多端，不踢旧连接

---

### 3.2 ws-handler.ts - WebSocket 消息处理

**职责**：连接管理、帧分发、Bot/Agent 会话逻辑、限流、在线状态。

#### 连接管理

```ts
connsByUser: Map<userId, Map<connId, ConnEntry>>  // 用户 → 连接列表（多设备）
wsToConn: WeakMap<WebSocket, ConnEntry>           // ws → 连接元信息
```

- **ConnEntry**：ws、userId、address、convId、connId
- **kickOthers**：单端模式时，新连接会踢掉该用户其他连接，发 KICKED 后 close

#### 帧类型与处理

| 帧类型 | 方向 | 处理逻辑 |
|--------|------|----------|
| HEARTBEAT_PING | C→S | 回 HEARTBEAT_PONG |
| LOAD_HISTORY | C→S | 分页拉取 beforeSeqId 之前的消息 |
| MARK_READ | C→S | 更新消息 status、metadata.readBy，广播 READ_RECEIPT |
| ADD_REACTION / REMOVE_REACTION | C→S | 更新 metadata.reactions，广播 REACTION_UPDATE |
| SEND_MESSAGE | C→S | 见下 |
| REQUEST_AGENT | C→S | 转人工 |
| SYNC | C→S | 按 afterSeqId 补拉消息 |

#### SEND_MESSAGE 分支

1. **限流**：`checkRateLimit`，滑动窗口 20 条/秒
2. **phase=bot**：
   - 贴纸：只 insert 用户消息 + ACK
   - `getBotReply === null`（如含「人工」）：insert 用户消息 + ACK + 转人工
   - 有回复：用户 + Bot 两条 insertMessages，ACK + MESSAGE
3. **phase=agent**：用户 + Agent 两条 insertMessages，ACK + MESSAGE
4. **phase=queuing**：只 insert 用户消息 + ACK

#### 转人工流程

1. `createAgentConversation` 创建 Agent 会话
2. 将该用户所有连接的 `convId` 切到 Agent 会话
3. `phase=queuing`，`queue_position=3`，每 2 秒 position--
4. position 到 0 时 `assignAgent`：插入欢迎消息，发 SESSION_SWITCHED

#### 双 id 查找

`getMessage(msgId, convId)`：先按 id 查；若无且 convId 存在，再按 `conversation_id + client_msg_id` 查，支持 ACK 前按 client_msg_id 操作。

---

### 3.3 db.ts - 数据层

**数据库**：better-sqlite3，单文件 `data/im.db`，WAL 模式，busy_timeout 5000ms。

#### 表结构

**users**
- id, address, created_at

**conversations**
- id, user_id, session_type(bot/agent), phase(bot/queuing/agent/closed)
- parent_conv_id, agent_id, agent_name, agent_code
- queue_position, queue_total, created_at, updated_at

**messages**
- id, conversation_id, seq_id, client_msg_id
- content, msg_type, sender_type, sender_id, sender_name
- status, metadata(JSON), timestamp

**nonces**
- nonce, address, expires_at（SIWE 用，5 分钟过期）

#### 索引

- `idx_messages_conv_seq`：(conversation_id, seq_id)
- `idx_conversations_user`：user_id
- `idx_conversations_user_type`：(user_id, session_type)
- `idx_nonces_expires`：expires_at

#### 关键 API

| 函数 | 说明 |
|------|------|
| ensureUser | 按 address 创建或返回用户 |
| createBotConversation | 新建 Bot 会话 |
| createAgentConversation | 新建 Agent 会话，关联 parent |
| getOrCreateBotConversation | 获取或创建当前 Bot 会话 |
| getConversation | 按 id 查会话 |
| updateConversation | 更新 phase、agent、queue |
| nextSeqId | 会话内 seq 自增 |
| insertMessage / insertMessages | 单条/批量插入（批量用 transaction） |
| getMessagesAfter | 按 afterSeqId 分页 |
| getMessagesBefore | 按 beforeSeqId 分页 |
| getMessage | 支持 server_msg_id 或 client_msg_id |
| updateMessageStatus / updateMessageMetadata | 更新状态和 metadata |
| searchMessages | LIKE 全文搜索 |
| createNonce / consumeNonce | SIWE nonce |

---

### 3.4 auth.ts - 认证

**SIWE 流程**：
1. 客户端 `getNonce(address)` → `/api/auth/nonce`
2. 钱包 signMessage → `/api/auth/verify` 传 message、signature
3. `consumeNonce` 验证 nonce，SiweMessage.verify 验证签名
4. `ensureUser` 获取 userId，jwt.sign 签发 token

**JWT**：secret 来自环境变量，默认 24h 过期。

**createDemoAuth**：随机 address，ensureUser + createToken，用于访客登录。

---

### 3.5 bot.ts - Bot 与 Agent 回复

**getBotReply(content)**：关键词匹配
- deposit/充值 → FAQ 存款
- 2fa/security → FAQ 安全
- withdraw/提现 → FAQ 提现
- human/agent/人工 → `null`（触发转人工）
- 其他 → 默认提示

**createBotMessage / createAgentMessage**：构造 Message 结构。

**getRandomAgentResponse**：从固定列表随机选一句 Agent 回复。

---

### 3.6 upload.ts - 文件上传

**multer**：本地 diskStorage，目录 `uploads/`，文件名 `uuid + ext`。

**限制**：10MB，类型 image/jpeg、png、gif、webp、application/pdf。

**getFileUrl**：`${API_URL}/uploads/${filename}`，用于消息中图片/PDF 链接。

---

## 四、数据流

### 4.1 连接建立

```
Client: new WebSocket('ws://host:3001/ws?token=xxx&fresh=1')
  → Server: wss.on('connection')
  → handleConnection(ws, token, fresh, kickOthers)
  → verifyToken(token) → 失败则 ERROR + close
  → fresh ? createBotConversation : getOrCreateBotConversation
  → 可选 kickOthers：踢掉该用户其他连接
  → 登记 connsByUser、wsToConn
  → getMessagesAfter(convId, 0) 取初始消息
  → send AUTH_OK { conversationId, phase, messages }
  → broadcastPresence
```

### 4.2 发送消息

```
Client: SEND_MESSAGE { content, type, id(client_msg_id), metadata }
  → checkRateLimit
  → db.nextSeqId、生成 serverMsgId
  → 根据 phase 决定：只用户 / 用户+Bot / 用户+Agent
  → db.insertMessages (transaction)
  → send MESSAGE_ACK { clientMsgId, serverMsgId, seqId }
  → 若有 Bot/Agent 回复，send MESSAGE
```

### 4.3 转人工

```
Client: REQUEST_AGENT
  → createAgentConversation(userId, parentBotId)
  → 切换该用户所有连接 convId
  → phase=queuing，queue_position=3
  → send PHASE_CHANGE
  → setInterval 每 2s position--，send QUEUE_STATUS
  → position<=0：assignAgent，插入欢迎消息，send SESSION_SWITCHED
```

---

## 五、配置与部署

| 环境变量 | 说明 |
|----------|------|
| PORT | 服务端口，默认 3001 |
| JWT_SECRET | JWT 密钥 |
| CLIENT_URL | CORS 允许的前端地址 |
| API_URL | 文件 URL 前缀（如 https://api.example.com） |

**单机部署**：直接 `tsx server/index.ts`，SQLite 单文件，无外部依赖。

**多实例**：需引入 Redis 等共享 connsByUser、限流状态，消息需跨实例路由。

---

## 六、面试要点

1. **为何用 ws 库**：轻量、API 简单、广泛使用
2. **为何用 SQLite**：单机、零配置、WAL 支持并发
3. **connsByUser 结构**：`Map<userId, Map<connId, ConnEntry>>`，支持多设备
4. **双 id 查找**：ACK 前用 client_msg_id，ACK 后用 server_msg_id
5. **insertMessages 事务**：用户+Bot/Agent 同事务，保证一致性
