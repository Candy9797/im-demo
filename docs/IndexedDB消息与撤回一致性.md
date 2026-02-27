# IndexedDB 缓存消息与撤回状态一致性

## 问题背景

消息列表会通过 **Zustand persist** 持久化到 **IndexedDB**（见 `chatPersistStorage`），用于离线恢复和 rehydration。流程大致是：

1. 在线时：收到/发送消息、撤回、编辑等都会更新 **内存** 里的 `messages`，persist 再把这份状态写入 IndexedDB。
2. 重连时：`auth_ok` 若带消息则用**服务端消息**覆盖内存；若服务端**不带消息**（空列表），则用 **getPersistedMessages** 从 IndexedDB 读出的本地缓存恢复。

**不一致场景**：

- 用户之前把一批消息存进了 IndexedDB。
- 之后**断线**（或关页面），在别的设备/会话里把其中**某一条撤回了**，服务端已更新。
- 用户**重连**时，若 `auth_ok` 返回**空消息**（或只返回增量、不包含“已撤回”的标记），前端会用 IndexedDB 的旧数据恢复。
- 结果：本地列表里仍显示**已被撤回的那条**，和服务端状态不一致。

也就是说：**IndexedDB 里的消息状态变了（服务端已撤回），但本地缓存还没更新，需要有一套机制把“已撤回”同步到本地并写回持久化。**

---

## 当前逻辑简述

| 环节 | 行为 |
|------|------|
| **auth_ok 有消息** | 用服务端返回的 `messages` **完全覆盖** 内存，再触发事件；后续 persist 会把这份写入 IndexedDB。此时若服务端列表里已不包含被撤回消息（或已是“已撤回”态），则一致。 |
| **auth_ok 空** | 用 **getPersistedMessages(conversationId)** 从 IndexedDB 读出本地缓存，赋给内存并派发事件。**不**和服务端做合并，因此若离线期间有撤回，本地仍显示旧内容。 |
| **在线时 MESSAGE_RECALL** | chatStore 收到后把对应消息改为「已撤回」并写 `metadata.recalled = true`，内存更新后 persist 会写入 IndexedDB，故**在线撤回**会自然同步到 IndexedDB。 |
| **重连后 SYNC** | 重连后若有 conversationId，会发 **SYNC(afterSeqId)** 拉取离线期间的新消息并**追加**到现有列表，不做“按服务端列表覆盖”或“按撤回列表删本地”。 |

因此，**只有在“auth_ok 空 + 只用 IndexedDB 恢复”** 时，会出现“本地还显示已撤回消息”的问题；若 auth_ok 或后续 sync 能提供“谁被撤回了”或“服务端权威列表”，就可以在客户端修正内存并依赖现有 persist 写回 IndexedDB。

---

## 解决方案

### 思路一：服务端在 auth_ok / sync 里带“撤回信息”（推荐）

**做法**：

- 服务端在 **auth_ok** 或 **sync 响应** 中增加字段，例如：
  - **recalledMessageIds**：离线期间（或全量）被撤回的消息 id 列表；或
  - 每条消息带 **recalled** / **status** 等标记，表示该条在服务端已撤回。
- 客户端在 **auth_ok** 或 **sync** 的回调里：
  - 若使用 **recalledMessageIds**：遍历当前 `conversation.messages`，将 id 在列表中的消息**删除**或**改为“已撤回”**（content 置为「已撤回」，metadata.recalled = true，与现有 MESSAGE_RECALL 处理一致）。
  - 若使用**每条消息的 recalled 标记**：用服务端返回的列表做**合并**（以服务端为准），本地有而服务端标记为已撤回的，在内存里同步为已撤回。
- 修正的是**内存**里的 `messages`；Zustand 会触发 persist，**IndexedDB 会在下一次 setItem 时被更新为修正后的状态**，无需单独写 IndexedDB。

**效果**：重连后无论 auth_ok 是“全量列表”还是“空 + 本地恢复”，只要服务端补发撤回信息，本地列表和 IndexedDB 都会与服务端一致。

---

### 思路二：auth_ok 空时不止用 IndexedDB，再主动拉服务端权威状态

**做法**：

- 当 **auth_ok 的 messages 为空** 且我们打算用 IndexedDB 恢复时，**不立刻只用本地**，而是：
  - 再发一次 **sync**（例如 afterSeqId=0 表示全量）或单独接口（如 get_conversation_messages），拉取服务端当前**权威消息列表**（含撤回态）；
  - 用服务端返回的列表**覆盖**内存中的 messages（或按 messageId 合并，以服务端为准）；
  - 若服务端不返回全量只返回增量，则需服务端同时返回 **recalledMessageIds** 或每条 recalled 标记，再按思路一在本地做删除/标记。
- 这样本地（内存）与 IndexedDB 后续都会被 persist 更新为与服务端一致。

**效果**：不依赖 auth_ok 是否带消息，只要“拉一次服务端状态”并覆盖/合并，就能纠正离线期间的撤回；实现上需要服务端提供“全量或带撤回信息的增量”接口。

---

### 思路三：auth_ok 始终带服务端权威列表（若架构允许）

**做法**：

- 服务端在 **auth_ok** 中始终带该会话的**权威消息列表**（至少最近 N 条或全量），且列表中已撤回的消息要么不返回，要么带 recalled 标记。
- 客户端**始终用 auth_ok 的 messages 覆盖**内存，不再在“auth_ok 空”时单独用 IndexedDB 恢复为唯一数据源；IndexedDB 仅作为 rehydration 前的快速展示或弱网时的降级，一旦 auth_ok 返回就用服务端数据覆盖。

**效果**：从源头上保证“重连后看到的就是服务端状态”；需要服务端有能力在 auth_ok 时带列表，且客户端接受“先可能看到旧缓存再被覆盖”的短暂不一致。

---

## 实现要点（以思路一为例）

1. **服务端**：在 auth_ok 或 sync 的 payload 中增加 `recalledMessageIds: string[]`（或等价字段）。
2. **IMClient（auth_ok 处理）**：在 `onAuthOk` 里，若存在 `recalledMessageIds`，则：
   - 遍历 `this.conversation.messages`，将 `id` 在 `recalledMessageIds` 中的项改为“已撤回”（与现有 MESSAGE_RECALL 一致：content、type、metadata.recalled），或从数组中移除；
   - 再派发一次 MESSAGE_RECALL 或 MESSAGES_RESET，让 chatStore 更新 UI 并触发 persist。
3. **IMClient（sync 处理）**：若 sync 的**响应**里带 `recalledMessageIds`，同样在内存里删除或标记对应消息，再通知 store。
4. **IndexedDB**：不需要改 chatPersistStorage 或 getPersistedChatState；persist 的 **partialize** 已经包含 `messages`，只要内存里的 `messages` 被修正，下一次 **setItem** 就会把修正后的列表写入 IndexedDB，下次打开或恢复时就是一致状态。

---

## 小结

| 问题 | IndexedDB 里存了旧消息，重连后拉最新时，其中某条在服务端已撤回，本地仍显示原内容。 |
|------|----------------------------------------------------------------------------------------|
| 根因 | auth_ok 空时只用 IndexedDB 恢复，未用服务端“撤回信息”修正本地列表。 |
| 方向 | 以服务端为权威，在 auth_ok 或 sync 中带 recalledMessageIds 或每条 recalled 标记，客户端在内存中删除或标记已撤回，persist 自然会把修正后的 messages 写回 IndexedDB。 |
| 可选方案 | 见上：思路一（带撤回列表/标记）、思路二（主动再拉服务端状态）、思路三（auth_ok 始终带权威列表）。 |

这样，**IndexedDB 里的消息状态变了（被撤回）** 时，只要在**写回 IndexedDB 之前**（即更新内存时）根据服务端信息修正列表，就能保证“前端缓存与服务端一致”。
