# chatPersistStorage

Zustand persist 的 IndexedDB 存储引擎，用于将 chatStore 部分状态持久化到本地，并在 rehydration 未完成时供 IMClient 直接读取离线消息。

---

## 功能

- 实现 Zustand persist 的 **StateStorage** 接口（`getItem` / `setItem` / `removeItem`），将 chatStore 选中的状态写入 IndexedDB。
- 持久化字段与 chatStore 的 **partialize** 一致：**messages**、**conversationId**。
- 提供 **getPersistedChatState()**：在 rehydration 尚未完成时，供 IMClient 直接从 IndexedDB 读取离线消息并展示，减少空白时间。

---

## 为何用 IndexedDB 而非 localStorage？

- 消息列表可能很大，**localStorage 约 5MB 限制**，且**同步阻塞主线程**。
- **IndexedDB 异步、容量大**，适合存储较多消息，不阻塞 UI。

---

## 为何 setItem 要防抖？

- 每次消息更新（新消息、ACK、编辑、反应等）都会触发 persist 的 `setItem`。
- IndexedDB 写入有开销，**频繁写入会卡顿、耗电**。
- **防抖 80ms**：将短时间内多次更新合并为一次写入，降低 I/O 频率。  
  流程：`setItem` 被调用 → 只更新内存中的 pending → 启动 80ms 定时器 → 若 80ms 内无新调用，定时器触发 → `flushWrite()` 把 pending 写入 IndexedDB。

---

## Rehydration 与 getPersistedChatState

### Rehydration 是什么？

- **Rehydration（补水/水合）**：把之前持久化到本地存储的状态，重新加载回内存并恢复到应用里的过程。
- **Dehydration（脱水）**：把内存里的 state 序列化后存到 IndexedDB / localStorage。
- **Rehydration**：从 IndexedDB / localStorage 读出并反序列化，还原为内存中的 state。

在本项目里，使用 Zustand persist 时：

- **Dehydration**：每次 chatStore 更新，persist 会把 partialize 选中的 state（messages、conversationId）写入 IndexedDB。
- **Rehydration**：页面加载时，persist 从 IndexedDB 读取，解析 JSON，再 `set` 回 store。  
  **Rehydration 是异步的**，所以 connect() 刚完成时，可能还没完成从 IndexedDB 的恢复，store 里的 `messages` 可能暂时为空。

### 为何需要 getPersistedChatState？

- Zustand persist 的 rehydration 是异步的，刚连上时 store 里的 messages 可能还没恢复，服务端又可能返回空消息。
- 若不从 IndexedDB 读，界面会先显示空列表，等 rehydration 完成才出现历史。
- 通过 **getPersistedChatState** 直接读 IndexedDB，可以在 rehydration 前就拿到离线消息并展示，减少空白时间。

---

## IndexedDB 里的消息状态变了怎么办？

### 内存 → IndexedDB（状态变更如何落盘）

- **以内存为准**：chatStore 是单一数据源，每次消息状态变更（如 SENDING → SENT、FAILED，或 ACK、已读、撤回等）都会触发 persist 的 `setItem`。
- **防抖写入**：`setItem` 只更新内存中的 pending，80ms 内无新调用时才执行 `flushWrite()` 写入 IndexedDB，因此 **IndexedDB 会在短暂延迟后与内存保持一致**，无需额外处理。

### IndexedDB → 内存（恢复时状态过期怎么办）

- **场景**：刷新或重连后从 IndexedDB 恢复（rehydration 或 `getPersistedChatState`），读到的快照可能是关闭页面前或断网前的状态，其中部分消息的 `status` 仍是 `sending`（当时尚未收到 ACK）。若直接展示，界面会一直显示「发送中」。
- **处理**：在「从 IndexedDB 读出并交给业务使用」前，对消息列表做**规范化**：把所有 `status === 'sending'` 的改为 `'failed'`，表示按「未确认结果」处理，避免悬空态。
- **实现位置**：
  - **getPersistedChatState()**：返回前对 `state.messages` 调用 `normalizePersistedMessages()`，供 IMClient 直接读时已是规范后的列表。
  - **chatStore persist merge**：rehydration 时若采用 IndexedDB 的列表（`perMax > curMax`），对 `per` 先做 `normalizePersistedMessages` 再写回 `messages`，保证 rehydration 后的 store 里没有遗留的 `sending`。

### 小结

| 方向 | 谁主导 | 说明 |
|------|--------|------|
| 内存 → IndexedDB | 内存 | 每次 store 变更触发 setItem（防抖 80ms），最终写入 IndexedDB，状态变更自动落盘。 |
| IndexedDB → 内存 | 读时规范化 | getPersistedChatState 与 merge 在采用 IDB 数据时，将 `sending` 规范为 `failed`，避免恢复后仍显示「发送中」。 |

---

## 调用关系

- **chatStore**：persist 中间件使用 `createJSONStorage(() => chatPersistStorage)`，state 变化时调用 `setItem`，初始化时调用 `getItem`。
- **IMClient**：连接成功后若 auth_ok 返回空消息列表，会调用 `getPersistedChatState(conversationId)`（通过 config 的 `getPersistedMessages` 注入），用返回的 messages 展示离线历史。

---

## API

| 名称 | 说明 |
|------|------|
| **chatPersistStorage** | 实现 StateStorage：`getItem(name)`、`setItem(name, value)`、`removeItem(name)`。setItem 带 80ms 防抖。 |
| **getPersistedChatState()** | 从 IndexedDB 读取并解析 chat 持久化状态；若有 pending 会先 flush。返回前对 messages 做 normalizePersistedMessages（sending → failed），避免恢复后仍显示「发送中」。 |
| **normalizePersistedMessages(messages)** | 将列表中 `status === 'sending'` 的消息改为 `'failed'`，用于从 IndexedDB 恢复时规范化状态。 |
| **PersistedChatState** | 类型：`{ messages: Array<...>, conversationId: string }`，与 partialize 一致。 |
| **CHAT_PERSIST_NAME** | 持久化 key，与 chatStore persist 的 name 一致（`"im-demo-chat"`）。 |

---

## 实现要点

- **openDB()**：打开 IndexedDB，`onupgradeneeded` 时创建 objectStore（keyPath: `"key"`），库名 `im-demo-chat`，版本 1。
- **防抖**：模块级 `pendingKey` / `pendingValue` / `flushTimer`；`setItem` 只更新 pending 并设 80ms 定时器，定时器触发或 `getPersistedChatState` 主动 flush 时调用 **flushWrite()** 真正写入。
- **flushWrite()**：清 timer、取 pending、清空 pending，用 transaction 把 `{ key, value }` 写入 STORE_NAME，完成后 close db。
- **removeItem**：取消未执行的 flush 定时器、清空 pending，再在 DB 里 delete(name)，用于 destroy 等场景。
