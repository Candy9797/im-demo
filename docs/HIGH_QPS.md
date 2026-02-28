# 高频消息场景优化指南 (High-QPS Message Handling)

本文档描述 IM 系统在高 QPS / 高频发消息场景下的优化策略与实现。

## 1. 客户端优化

### 1.1 消息队列批处理 (MessageQueue)
- **入站批处理**: 接收消息先入队，每 50ms 批量 flush，减少 React setState 调用
- **出站批处理**: 发送消息按 batchSize=30 批处理；**多条消息合并为一帧**（payload 为数组），大幅降低 WebSocket 帧数（详见 [批量发送技术方案](./批量发送技术方案.md)）
- **去重**: 5s 窗口内按 message.id 去重，避免重复渲染
- **配置**: `flushInterval: 50`, `batchSize: 30`, `maxSize: 2000`

### 1.2 Store 批量更新
- **MESSAGE_BATCH_RECEIVED**: 多条消息一次 `set({ messages: [...s.messages, ...batch] })`
- 单次渲染更新替代多次，降低重绘成本

### 1.3 IndexedDB 写入优化

- **saveMessage**: 80ms 防抖 + 批量写入，缓冲达 50 条立即 flush
- **saveMessages**: 大批量（auth/sync）直接写入
- **getMessages 前**: 自动 flush 未写入缓冲，保证读一致性

**flush 含义**：把内存中的待写缓冲（writeBuffer）一次性写入 IndexedDB。流程：`saveMessage(msg)` → 先放入 `writeBuffer` → 80ms 后（或缓冲满 50 条）→ `flushBuffer()` 取出所有消息 → `doWrite()` 批量 put 到 IndexedDB → 清空缓冲。防抖 + 批量写入，减少 IndexedDB 的 put 调用次数。

**getMessages 前 flush**：读取前先执行 `flushBuffer()`，把尚未落库的缓冲写入，再查询。避免读到「脏数据」（缓冲里有但 IndexedDB 里还没有）。

**为何用 IndexedDB**：为本地持久化，弱网/断网只是典型场景之一。具体作用：消息存浏览器本地，刷新、关标签、断网后仍可恢复；断线重连时可先用本地数据展示，再 sync 补拉；冷启动时在 auth_ok 到达前可从 IndexedDB 读取已有会话，减少白屏。刷新、关标签在网络正常时也会发生，不依赖弱网。

### 1.4 虚拟化渲染 (react-virtuoso)
- 仅渲染可视区 + overscan 消息，DOM 数量与视口相关
- 数千条历史消息时，实际渲染 ~20–30 个 MessageItem

## 2. 服务端优化

### 2.1 限流 (Rate Limit)
- 每用户每秒最多 **20 条** 消息
- 超限返回 `{ code: "rate_limit" }`
- 配置: `RATE_LIMIT_MSGS_PER_SEC`, `RATE_WINDOW_MS`

### 2.2 批量 DB 写入
- **insertMessages**: 用户消息 + Bot/Agent 回复在同一事务内插入
- 单次 `db.transaction()` 替代多次 `insertMessage`
- 使用 prepared statement 复用

### 2.3 数据库
- **WAL 模式**: 读写并发更好
- **busy_timeout**: 5s，减少锁竞争失败
- **synchronous NORMAL**: 平衡安全与性能

## 3. 数据流概览

```
[WebSocket 收包] → frame_in
  → enqueueIncoming (入队)
  → [50ms 定时 flush]
  → handleIncomingBatch
  → emit MESSAGE_BATCH_RECEIVED
  → saveMessages (IndexedDB 批写)
  → [Store] set({ messages: [...s.messages, ...batch] })
  → [Virtuoso] 只渲染可见项
```

## 4. 可调参数

| 模块 | 参数 | 默认值 | 说明 |
|------|------|--------|------|
| MessageQueue | flushInterval | 50 | 批处理间隔 ms |
| MessageQueue | batchSize | 30 | 每批最大条数 |
| IndexedDBStore | WRITE_DEBOUNCE_MS | 80 | saveMessage 防抖 |
| ws-handler | RATE_LIMIT_MSGS_PER_SEC | 20 | 每用户/秒上限 |

## 5. 进一步优化方向

- **服务端**: 多实例 + Redis 限流、消息队列 (Redis/RabbitMQ) 异步处理
- **客户端**: 发送节流、更激进的虚拟化 overscan 调节
- **协议**: 支持批量 ACK、批量 sync 请求

## 6. 相关文档

- [批量发送技术方案](./批量发送技术方案.md)：出站消息合并为一帧发送的协议与实现
