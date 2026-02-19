# IM 面试问答

> 以问答形式梳理面试官可能问到的问题及回答要点，便于快速准备。

---

## 一、架构与设计

### Q1：你们 IM 的整体架构是怎样的？

采用分层架构：最上层是 Zustand + React 的 UI 层，中间是自研 SDK（IMClient、MessageQueue、WebSocketManager），底层是 WebSocket 和 IndexedDB。

IMClient 负责会话管理和事件派发；WebSocketManager 负责连接、心跳、重连；MessageQueue 负责入站/出站批处理和去重；IndexedDBStore 负责离线持久化。Store 通过订阅 IMClient 的 SDKEvent 来更新 UI。

---

### Q2：为什么选择 WebSocket 而不是 HTTP 轮询？

WebSocket 是全双工长连接，服务端可以主动推送，延迟更低；HTTP 轮询需要客户端不断发请求，延迟和资源消耗都更高。IM 对实时性要求高，WebSocket 更适合。

---

### Q3：IMClient 和 WebSocketManager 的职责边界是什么？

WebSocketManager 只管连接：建立/关闭 WebSocket、收发帧、心跳、重连，不关心业务。IMClient 负责业务：发送消息、处理 ACK、历史拉取、同步、转人工等，内部持有 WebSocketManager，通过它发送帧和订阅事件。

---

## 二、消息可靠性与去重

### Q4：如何保证消息不丢？

- **发送侧**：乐观更新 + ACK。发送后立即展示，ACK 失败会重试；MessageQueue 对发送失败有指数退避重试，最多 3 次。
- **接收侧**：IndexedDB 持久化，收到消息后写入本地，断网也能恢复。
- **断线恢复**：重连后发 SYNC 帧，按 `afterSeqId` 补拉断线期间的消息，与本地合并。

---

### Q5：如何保证消息不重？

多层去重：MessageQueue 用 `seenIds` Map，5 秒窗口内见过的 id 直接丢弃；Store 在 MESSAGE_BATCH_RECEIVED、HISTORY_LOADED 时用 `ids.has(m.id)` 过滤；IMClient 的 frame_in 也会检查 `conversation.messages` 是否已有该 id；IndexedDB 的 keyPath 是 id，put 会覆盖同 id，天然去重。

---

### Q6：为什么要 client_msg_id 和 server_msg_id 两套 ID？

用户发消息需要立刻展示（乐观更新），此时服务端还没落库，没有 server_msg_id。客户端先生成 client_msg_id 用于临时标识；服务端落库后生成 server_msg_id；ACK 帧携带两者，客户端用 client_msg_id 找到乐观消息，把 id 替换成 server_msg_id。之后所有逻辑（已读、反应等）都用 server_msg_id。

---

### Q7：消息顺序如何保证？

服务端 `seq_id` 单调递增；历史拉取按 `beforeSeqId` 分页，同步按 `afterSeqId` 补拉；合并时按 seq_id 或 timestamp 排序。客户端展示时统一按序排列。

---

## 三、连接与重连

### Q8：断线重连后如何恢复？

1. WebSocketManager 检测到 onclose/onerror，用指数退避（1s 起，最大 30s）重连，最多 5 次。
2. 重连期间 MessageQueue 调用 `pause()`，暂停 flush。
3. 重连成功后先发 SYNC 帧，payload 为 `{ afterSeqId }`，服务端返回该 seq 之后的消息。
4. 客户端按 id 去重、按 seq 排序后与本地消息合并。
5. MessageQueue 调用 `resume()`，恢复正常处理。

---

### Q9：为什么用指数退避重连？

如果所有客户端断线后都在同一时刻重连，会造成服务端瞬时压力过大（惊群）。指数退避 + 随机抖动可以错开重连时间，减轻服务端压力。

---

### Q10：心跳机制的作用是什么？

WebSocket 长时间无数据时，中间网络（NAT、防火墙）可能回收连接，但两端不一定能立刻感知。心跳定期发 PING，服务端回 PONG，可以保活连接，并及早发现死连接，触发重连。

---

## 四、高频场景优化

### Q11：高频消息场景（如群聊、行情推送）如何优化？

- **MessageQueue 批处理**：入站消息先入队，每 50ms flush 一批到 Store，减少 setState 次数。
- **Store 批量更新**：MESSAGE_BATCH_RECEIVED 一次合并多条消息，而不是逐条 set。
- **IndexedDB 防抖**：saveMessage 用 80ms 防抖 + 50 条缓冲，减少写入次数；大批量用 saveMessages 直接事务写。
- **虚拟列表**：react-virtuoso 只渲染可视区，千条消息 DOM 恒定约 20 个。
- **服务端限流**：每用户 20 条/秒，超限返回 rate_limit。

---

### Q12：为什么批处理用 50ms 间隔？

太短批处理效果差，setState 仍然很频繁；太长用户会感觉消息延迟。50–100ms 是常见的折中区间，既能显著减少渲染次数，又保持较好的实时感。

---

### Q13：MessageQueue 的 pause/resume 有什么用？

断线重连时，如果继续 flush 入队消息，可能把不完整或重复的数据推到 Store。重连期间 pause，等 sync 补拉完成、状态稳定后再 resume，保证数据一致性。

---

## 五、离线与持久化

### Q14：IndexedDB 的写入策略是怎样的？

- **单条写入**（如 ACK 更新）：saveMessage 先入 buffer，80ms 防抖或满 50 条即 flush 到 IndexedDB。
- **批量写入**（auth_ok、sync）：直接用 saveMessages 事务写入，不做防抖。
- **读前一致性**：getMessages 前会先 flush 未写入的 buffer，避免读到脏数据。

---

### Q15：为什么 IndexedDB 要防抖而不是每条都写？

IndexedDB 的 put 是异步的，写入次数多了会阻塞主线程、影响渲染。高频 ACK 等场景下，防抖和批量缓冲可以合并多次写入为一次事务，显著降低 I/O 压力。

---

## 六、同步与历史

### Q16：auth_ok、sync、load_history 分别做什么？

- **auth_ok**：连接成功后服务端发送，携带 conversationId、phase、历史 messages，客户端初始化会话。
- **sync**：断线重连后客户端发送 `{ afterSeqId }`，服务端返回该 seq 之后的消息，用于补拉断线期间的消息。
- **load_history**：用户滚动到顶部时，客户端发送 `{ beforeSeqId }`，服务端按 seq 分页返回更早的历史。

---

### Q17：sync 时 afterSeqId 如何确定？

本地维护每个会话的最大 seq_id（可从 IndexedDB 或当前 messages 中取 max），断线重连后把这个值发给服务端，服务端返回比它更大的消息。

---

## 七、协议与帧

### Q18：WebSocket 帧结构是怎样的？

```json
{
  "type": "send_message",
  "seq": 1,
  "timestamp": 1739260800000,
  "payload": { ... }
}
```

type 区分业务类型；seq 便于调试和顺序追踪；timestamp 用于时间戳；payload 为业务数据。

---

### Q19：主要有哪些帧类型？

客户端发：send_message、ping、request_agent、sync、load_history、mark_read、add_reaction 等。服务端发：auth_ok、message、message_ack、pong、queue_status、session_switched、sync_response、history_response、error 等。

---

## 八、双会话与转人工

### Q20：Bot 会话和 Agent 会话有什么区别？

Bot 是用户与智能助手的会话（conv-bot-*）；Agent 是转人工后的会话（conv-agent-*），通过 parent_conv_id 关联 Bot。转人工时服务端创建新的 Agent 会话，发送 SESSION_SWITCHED，客户端切换 conversationId 并重置 messages。

---

### Q21：转人工的排队流程是怎样的？

用户点转人工 → 发 REQUEST_AGENT → 服务端创建 Agent 会话，设置 phase=QUEUING，发送 QUEUE_STATUS（position、estimatedWait）→ 客户端展示排队位置 → 定时器递减 position，到 0 时分配客服 → 发送 SESSION_SWITCHED，客户端进入人工对话。

---

## 九、实现细节与难点

### Q22：引用回复的乐观更新如何实现？

发送时立即构造带 `metadata.quote` 的消息推入列表；ACK 时用 client_msg_id 匹配并更新 id。引用目标可能只有 client_msg_id，展示时需兼容两种 id。

---

### Q23：消息反应（emoji）如何做乐观更新？

addReaction/removeReaction 在 Store 中直接修改对应消息的 metadata.reactions，UI 即时反馈；服务端 getMessage 支持按 client_msg_id 查找，更新后广播 REACTION_UPDATE。反应按 userId 维度存储，同一用户对同一 emoji 只记录一次。

---

### Q24：弹层选择器（如 EmojiPicker）被父级 overflow 裁剪怎么办？

用 React Portal 把选择器渲染到 document.body，用 position: fixed + getBoundingClientRect() 计算位置，脱离父级 overflow。滚动、resize 时需要重新计算坐标。

---

### Q25：虚拟列表（Virtuoso）父容器高度为 0 怎么解决？

flex 子元素默认 min-height: auto 会阻止收缩。需要给父容器设 height: 100vh，flex 链上设置 min-height: 0，Virtuoso 的容器用 position: absolute; inset: 0 填满，才能得到正确高度。

---

### Q26：Zustand + Immer 时，Store 和 IMClient 如何避免引用共享问题？

IMClient 维护自己的 conversation.messages，不与 Store 共享引用。Store 通过事件拿到消息后，用 set({ messages: [...prev, ...batch] }) 写入，避免把 Immer 冻结的对象传给 SDK，导致后续修改失败。

---

## 十、扩展与优化方向

### Q27：如果要做多实例部署，需要考虑什么？

连接和会话要能在实例间共享：用 Redis 存 connsByUser、限流计数等；消息路由要能跨实例投递；可选消息队列（Kafka/RabbitMQ）做异步处理。

---

### Q28：为什么服务端用 SQLite 而不是 PostgreSQL？

当前是单机部署，SQLite 配置简单、无额外依赖，WAL 模式下读写并发够用。多写、分布式场景下会考虑 PostgreSQL。

---

### Q29：你会如何进一步优化高频场景？

- 批量 ACK、批量 sync，减少帧数
- 出站消息也做 IndexedDB 持久化，刷新不丢待发消息
- 服务端 prepared statement、批量 insert 进一步优化 DB 写入
- 可选：Web Worker 处理 MessageQueue，减轻主线程压力
