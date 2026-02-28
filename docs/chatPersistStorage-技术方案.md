# chatPersistStorage 技术方案

> 面试向：IM 离线消息持久化设计与实现

---

## 一、背景与需求

### 1.1 业务场景

客服 IM 场景下，用户刷新页面或重新打开时，需要**优先展示本地已存在的聊天记录**，再在后台与服务端同步，而不是先显示空白，再等接口返回。

### 1.2 核心需求

| 需求 | 说明 |
|------|------|
| 离线消息可见 | 刷新/关闭后重新打开，能立即看到最近会话消息 |
| 写入不卡顿 | 消息更新频繁（新消息、ACK、已读、反应等），存储不能阻塞主线程 |
| 数据量友好 | 消息列表可能很大，需支持较大存储容量 |
| 时序正确 | 连接成功后，若 rehydration 尚未完成，IMClient 需能直接读到最新持久化数据 |

---

## 二、技术选型

### 2.1 为什么用 IndexedDB 而不是 localStorage？

| 维度 | localStorage | IndexedDB |
|------|--------------|-----------|
| 容量 | ~5MB | 数百 MB 级 |
| 访问方式 | 同步，阻塞主线程 | 异步，不阻塞 |
| 适用场景 | 少量配置、token | 大量结构化数据 |

IM 消息列表可能包含几十～几百条消息（含 content、metadata、reactions 等），JSON 体积可能超过 1MB。localStorage 容易超限，且同步写入会卡顿。**IndexedDB 异步、容量大，更适合作为聊天记录的持久化存储。**

### 2.2 为什么用 Zustand persist 而不是手写持久化？

- 与现有 Zustand store 无缝集成
- 自动在 state 变更时触发 setItem
- 支持 partialize 只持久化部分字段，避免存不可序列化的 client、auth 等
- 统一的 rehydration 流程

---

## 三、架构设计

### 3.1 整体结构

```
┌──────────────────────────────────────────────────────────────────┐
│  chatStore (Zustand + persist)                                    │
│  - partialize: 仅 messages、conversationId                        │
└──────────────────────────┬───────────────────────────────────────┘
                           │ createJSONStorage(chatPersistStorage)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  chatPersistStorage                                               │
│  - getItem / setItem / removeItem 实现 StateStorage 接口          │
│  - setItem 防抖 80ms，减少写入频率                                │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  IndexedDB (web3-im-chat)                                         │
│  - key: CHAT_PERSIST_NAME ("web3-im-chat")                        │
│  - value: JSON 序列化的 { state: { messages, conversationId } }   │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 数据流

**写入路径：**
```
store 更新 → partialize 提取 messages/conversationId 
→ persist 序列化 → setItem(value) 
→ 防抖 80ms → flushWrite() → IndexedDB put
```

**读取路径（Zustand rehydration）：**
```
页面加载 → persist 调用 getItem 
→ IndexedDB get → JSON.parse 
→ set 回 store
```

**读取路径（IMClient 离线恢复）：**
```
auth_ok 返回空消息 → getPersistedChatState() 
→ 若有 pending 先 flush → getItem 
→ 解析并校验 → 返回 { messages, conversationId }
```

---

## 四、核心设计点

### 4.1 setItem 防抖（80ms）

**问题：** 每次消息更新（新消息、ACK、已读、反应、编辑等）都会触发 persist 的 setItem，短时间内可能连续触发多次。IndexedDB 写入有 I/O 开销，频繁写入会导致：
- 主线程被异步回调占用
- 移动端耗电增加
- 并发写入增加失败概率

**方案：** 防抖。setItem 不立即写库，而是更新 `pendingKey/pendingValue`，启动 80ms 定时器。80ms 内若有新调用，只更新 pending，不重置 timer。timer 到期后再执行 `flushWrite()` 真正写入。

**效果：** 短时间内多次更新合并为一次写入，显著降低 I/O 频率。

**取值依据：** 80ms 对用户无感知，又能覆盖典型的消息连发场景（如快速点赞、多条消息连续到达）。

### 4.2 getPersistedChatState 与 Rehydration 竞态

**问题：** Zustand persist 的 rehydration 是异步的。页面加载后，用户可能很快完成登录并触发 `client.connect()`。此时：
- persist 可能尚未从 IndexedDB 读完数据
- store 里的 messages 仍为空
- auth_ok 若返回空消息列表，IMClient 会拿不到历史

若只依赖 store，用户会先看到空白，等 rehydration 完成才出现历史，体验差。

**方案：** 提供 `getPersistedChatState()`，直接读 IndexedDB，不依赖 store。IMClient 在 auth_ok 收到空消息时，调用此函数获取离线消息并展示。

**关键实现：** 若 `pendingValue !== null` 且有未执行的 flush，说明最新状态还在内存里未落盘。此时先 `flushWrite()`，再 `getItem`，保证读到的是**最新数据**，避免读到旧快照。

### 4.3 removeItem 时的防抖清理

**问题：** 用户登出或 destroy 时，会调用 `removeItem` 清空持久化。若此时防抖 timer 尚未触发，pending 里还有未写入的数据，直接 delete 会导致：
- 下次读取时拿到的是删除前的旧数据（因为 pending 未被持久化）
- 或者逻辑混乱

**方案：** removeItem 时：
1. 若有 flushTimer，先 clearTimeout 取消
2. 清空 pendingKey、pendingValue
3. 再执行 IndexedDB 的 delete

这样就不会把「待写入」的数据误保留下来，也不会误删。

### 4.4 持久化字段最小化（partialize）

只持久化 `messages` 和 `conversationId`，不持久化：
- client：对象实例，不可序列化
- auth：敏感且有过期时间，需重新登录
- connectionState、phase 等：运行时状态，需与服务端重新同步
- isOpen、typing 等 UI 状态：刷新后重置即可

**好处：** 存储体积小、安全、语义清晰，且避免序列化不可序列化的对象。

---

## 五、接口与实现要点

### 5.1 StateStorage 接口

Zustand persist 的 `createJSONStorage` 要求传入的对象实现：

```ts
interface StateStorage {
  getItem: (name: string) => Promise<string | null> | string | null;
  setItem: (name: string, value: string) => Promise<void> | void;
  removeItem: (name: string) => Promise<void> | void;
}
```

chatPersistStorage 完整实现上述三个方法，且均为 async，符合异步存储的规范。

### 5.2 数据结构

IndexedDB 使用 keyPath `key`，存 `{ key, value }`。value 为 Zustand 序列化后的 JSON 字符串，结构为：
```json
{
  "state": {
    "messages": [...],
    "conversationId": "conv-xxx"
  },
  "version": 1
}
```

### 5.3 getPersistedChatState 的健壮性

- 先 flush 再读，保证数据最新
- JSON.parse 失败时返回 null，不抛错
- 校验 `messages` 为数组、`conversationId` 为字符串，非法数据返回 null

---

## 六、面试可展开的点

### 6.1 为什么是 80ms？

- 比 16ms（一帧）长，能合并多帧内的更新
- 比 200ms 短，用户操作后很快落盘，刷新/崩溃时数据不会丢太多
- 可根据业务调整，如弱网场景可适当加长

### 6.2 防抖会丢数据吗？

不会。每次 setItem 都更新 pending 为**最新值**，最后只写一次，写的就是最新状态。防抖只是合并写入次数，不改变最终写入内容。

### 6.3 若 flush 失败怎么办？

`flushWrite().catch(() => {})` 吞掉错误，避免未捕获异常。生产环境可加日志上报，或实现重试。当前设计优先保证不阻塞主流程。

### 6.4 与 service worker / 离线优先的关系？

当前方案是「本地缓存 + 在线同步」的离线优先思路。若要做 PWA 离线可用，可在此基础上扩展：service worker 缓存静态资源，chatPersistStorage 负责聊天数据，二者配合实现完整的离线体验。

---

## 七、总结

| 设计点 | 解决的问题 | 效果 |
|--------|------------|------|
| IndexedDB | localStorage 容量小、同步阻塞 | 大容量、异步、不卡顿 |
| setItem 防抖 | 频繁写入导致 I/O 压力 | 合并写入，降低频率 |
| getPersistedChatState | rehydration 与 connect 竞态 | 离线消息立即可见 |
| removeItem 清 timer | 防抖未执行时删除逻辑错误 | 删除行为正确 |
| partialize 最小化 | 安全、体积、可序列化 | 只存必要字段 |

整体上，方案在**性能、容量、时序正确性**之间做了平衡，适合 IM 这种高频更新、对离线体验有要求的场景。
