# WebSocket 消息流程

根据 WebSocket 帧收发顺序，IM 通信可梳理为以下流程。

## 1. 连接与认证

| 方向 | 帧类型 | 说明 |
|------|--------|------|
| ↓ | `auth_ok` | 认证成功，服务端下发 `conversationId`，建立会话 |
| ↓ | `presence_update` | 在线状态更新（谁在线） |

**流程**：WebSocket 连上 → 服务端校验 token → 下发 `auth_ok` → 同步在线用户

---

## 2. 历史消息拉取

| 方向 | 帧类型 | 说明 |
|------|--------|------|
| ↑ | `load_history` | 客户端请求历史，`beforeSeqId` 表示「拉取 seq 比它小的更早消息」 |
| ↓ | `history_response` | 服务端返回一批历史消息 |

**流程**：连接成功后 → 发 `load_history` → 收到 `history_response` → 插入本地消息列表，用于向上滚动加载更多

### beforeSeqId 说明

| 项 | 说明 |
|----|------|
| **类型** | `number`，是**服务端序号 seqId**，不是时间戳 |
| **含义** | 拉取「seq 小于 beforeSeqId」的更早消息 |
| **如何得到** | 取当前消息列表中**最小的 seqId**；若无 seqId 则用 timestamp 兜底 |

**客户端计算**（chatStore.loadMoreHistory）：

```ts
const minSeq = Math.min(...messages.map((m) => m.seqId ?? m.timestamp));
client.loadHistory(minSeq);
```

**服务端查询**（db.getMessagesBefore）：

```sql
SELECT ... WHERE conversation_id = ? AND seq_id < ? ORDER BY seq_id DESC LIMIT ?
```

**seqId vs timestamp**：消息的 `seqId` 由服务端分配（message_ack 时下发），用于排序与分页；`timestamp` 为客户端/服务端时间戳。优先用 seqId，无 seqId 时用 timestamp 兜底。

---

## 3. 消息发送与确认

| 方向 | 帧类型 | 说明 |
|------|--------|------|
| ↑ | `send_message` | 客户端发送消息（带 clientMsgId）；payload 支持单条 `Message` 或批量 `Message[]` |
| ↓ | `message_ack` | 服务端确认收到；payload 支持单条 `{ clientMsgId, serverMsgId, seqId }` 或批量数组 |

**流程**：`sendMessage` → 入队 → 批量 flush 时发 `send_message`（单条发对象，多条发数组）→ 收到 `message_ack` → 更新状态为 SENT，匹配 clientMsgId

**批量 ACK**：一条 `message_ack` 对应一批 `send_message`，payload 条数 = 该批成功处理的消息数（1～batchSize，限流时更少）。

**批量发送**：详见 [批量发送技术方案](./批量发送技术方案.md)

---

## 4. 消息接收

| 方向 | 帧类型 | 说明 |
|------|--------|------|
| ↓ | `message` | 服务端推送新消息（Bot/Agent 回复等） |

**流程**：收到 `message` 帧 → 入队 → 去重 → 派发 MESSAGE_RECEIVED

---

## 5. 已读状态

| 方向 | 帧类型 | 说明 |
|------|--------|------|
| ↑ | `mark_read` | 客户端标记某条消息已读 |
| ↓ | `read_receipt` | 服务端下发已读回执 |

**流程**：`markAsRead(messageIds)` → 发 `mark_read` → 收到 `read_receipt` → 更新消息已读状态

---

## 6. 转人工与排队

| 方向 | 帧类型 | 说明 |
|------|--------|------|
| ↑ | `request_agent` | 客户端请求转人工客服 |
| ↓ | `phase_change` | 服务端通知会话阶段变更（bot → queuing → agent） |
| ↓ | `queue_status` | 排队状态更新，多次下发，含 position、total、estimatedWait |
| ↓ | `session_switched` | 分配客服完成，下发新 conversationId、agentInfo、messages |

**流程**：`requestHumanAgent()` → 发 `request_agent` → 收到 `phase_change`（进入 queuing）→ 多次 `queue_status`（排队位置）→ 收到 `session_switched`（分配完成，进入 agent）

---

## 7. 心跳保活

| 方向 | 帧类型 | 说明 |
|------|--------|------|
| ↑ | `ping` | 客户端发心跳（默认 30s 一次） |
| ↓ | `pong` | 服务端回复心跳 |

**流程**：定时发 `ping` → 收到 `pong`，保持连接活跃

---

## 8. 帧序列号 (seq)

每帧包含 `seq` 字段，用于排序、去重或调试。**客户端与服务端各自维护独立的 seq 计数器**。

### 8.1 两个独立的 seq 流

| 方向 | seq 来源 | 说明 |
|------|----------|------|
| **↑ 客户端 → 服务端** | 客户端 WebSocketManager | `send_message`、`load_history`、`ping` 等，从 1 递增 |
| **↓ 服务端 → 客户端** | 服务端 ConnEntry.outSeq | `auth_ok`、`message_ack`、`message`、`error` 等，从 1 递增 |

### 8.2 为何网络面板中 seq 看起来不单调？

网络面板按**时间**混排展示所有帧（↑ 和 ↓ 交错）。两个方向各自单调递增，但混在一起看会「跳动」：

```
时间线 →
↑ send_message  seq:1  (客户端发出的第 1 条)
↓ message_ack   seq:3  (服务端发出的第 3 条)
↑ send_message  seq:2  (客户端发出的第 2 条)
↓ message       seq:4  (服务端发出的第 4 条)
```

**正确理解**：分别只看 ↑ 或 ↓，seq 各自单调递增。

### 8.3 seq 与 seqId 的区别

| 字段 | 作用域 | 递增 | 说明 |
|------|--------|------|------|
| **seq** | 连接（按发送方向） | 是，连续 | 帧的序列号，客户端/服务端各自维护；每发一帧 +1 |
| **seqId** | 会话 | 是，但可能不连续 | 消息在会话内的序号，`db.nextSeqId(convId)` 分配；用于排序与分页（message_ack 时下发） |

`message_ack` 的 payload 含 `seqId`，**仅指用户消息**的序号；Bot/Agent 回复也会占用 seqId，但不会出现在 message_ack 里。因此 message_ack 的 seqId 序列可能为 10、12、14…（中间 11、13 为 Bot 回复），**单调递增但不连续**。批量发送两条用户消息时，会收到两个 message_ack，seqId 分别为 10、12。

---

## 整体时序

```
connect()
  → auth_ok（建立会话）
  → presence_update（在线列表）
  → load_history → history_response（拉取历史）

用户发消息
  → send_message → message_ack（确认）

收到 Bot/Agent 回复
  → message

用户读消息
  → mark_read → read_receipt

转人工
  → request_agent
  → phase_change（进入排队）
  → queue_status（多次，排队位置）
  → session_switched（分配完成）

保活
  → ping ↔ pong（周期性）
```

---

## 流程汇总

| 序号 | 流程 | 上行帧 | 下行帧 |
|------|------|--------|--------|
| 1 | 连接与认证 | - | auth_ok, presence_update |
| 2 | 历史消息拉取 | load_history | history_response |
| 3 | 消息发送与确认 | send_message | message_ack |
| 4 | 消息接收 | - | message |
| 5 | 已读状态 | mark_read | read_receipt |
| 6 | 转人工与排队 | request_agent | phase_change, queue_status, session_switched |
| 7 | 心跳保活 | ping | pong |

---

## 与 SDK 的对应关系

| 流程 | IMClient | WebSocketManager | MessageQueue |
|------|----------|------------------|--------------|
| 连接认证 | `connect()` 等待 auth_ok | 建立 ws、解析帧 | - |
| 历史 | `loadHistory()`、监听 history_response | 收发帧 | - |
| 发消息 | `sendMessage()`、监听 message_ack | `send(SEND_MESSAGE)` | 入队、ACK 超时重发 |
| 收消息 | 监听 frame_in、派发 MESSAGE_RECEIVED | 解析 MESSAGE 帧 | 入站去重、批处理 |
| 已读 | `markAsRead()`、监听 READ_RECEIPT | 收发 mark_read/read_receipt | - |
| 转人工 | `requestHumanAgent()`、监听 queue_update/agent_assigned | 收发 request_agent 等 | - |
| 心跳 | - | 定时 ping、忽略 pong | - |
