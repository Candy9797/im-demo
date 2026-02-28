# Immer 原理与最佳实践
“比如IM状态包含user和sessions，仅修改其中一个会话的消息，Immer 会只生成该会话的新引用，user和其他会话复用原始引用，无需深拷贝整个复杂状态，性能更优。”
## 1. Immer 解决什么问题？

**核心**：让你用「可变」的写法，自动得到**不可变**的更新。

```ts
// 不用 Immer：要写很多 spread
set((s) => ({
  messages: s.messages.map((m) =>
    m.id === id ? { ...m, metadata: { ...m.metadata, reactions: r } } : m
  ),
}));

// 用 Immer：像改普通对象
set((state) => {
  const m = state.messages.find((x) => x.id === id);
  if (m) m.metadata.reactions = r;
});
```

## 2. Immer 的好处

| 好处 | 说明 |
|------|------|
| **写法简洁** | 少写 spread、map，嵌套更新更直观 |
| **不易出错** | 不用记得每一层都要 spread，漏字段概率低 |
| **可读性强** | `state.typing.isTyping = true` 比 `{ ...s.typing, isTyping: true }` 更易读 |

## 3. 为什么需要不可变更新？

### 3.1 React 靠引用判断是否变化

```ts
// 引用变了 → React 认为数据变了 → 触发重渲染
const newState = { ...oldState, count: 1 };

// 直接改原对象 → 引用不变 → 可能不触发重渲染
oldState.count = 1;
```

### 3.2 Zustand / Redux 同理

这些库用**引用是否变化**判断 state 是否更新。必须返回新的 state 对象，订阅者才能正确收到更新。

### 3.3 支持高级能力

- **时间旅行 / 撤销**：每次都是新对象，历史版本可保留
- **React 18 并发**：需要区分「旧状态」与「新状态」

## 4. Immer 如何工作？

每次 `set((state) => { state.xxx = ... })` 时：

1. Immer 基于当前 state 创建 **draft**（Proxy）
2. 你在 draft 上的修改**不会改动原始 state**
3. 修改结束后，Immer 根据 draft 的变更**生成新的 state 对象**
4. 原始 state 保持不变

```
原始 state A  →  Immer 创建 draft  →  你在 draft 上改  →  生成新 state B
     ↑                                                           ↑
  不会被修改                                              新的不可变对象
```

**结论**：每次更新都会产出新对象，之前的版本不会被改写，只是不再被引用。

### 关于历史版本

Immer **不会**替你保存历史，只是保证每次 produce 都生成新对象。若要拿到历史版本，需要自行存储（如 Redux DevTools 的做法）。

## 5. 为什么用了 Immer 还要拷贝？

Immer 只处理 **Zustand 的 state**，不处理 **IMClient（SDK）** 的数据。

| 数据来源 | 归属 | Immer 是否处理 |
|----------|------|----------------|
| Zustand state | 应用内部 | ✅ 会被 Immer 包装 |
| IMClient 的 conversation.messages | SDK 内部 | ❌ 和 Zustand 无关 |

若直接把 IMClient 的对象引用放进 state（如 `messages: client.getConversation().messages`），则：

- Zustand 和 IMClient 共享同一批对象
- Immer 在 produce 结束时会**冻结**最终 state 及其内部的引用
- IMClient 之后再改这些对象（如 `msg.id = xxx`、`messages.push()`）会报错：`Cannot assign to read only property`、`object is not extensible`

**拷贝的目的**：在 Zustand 与 IMClient 之间做数据隔离，避免把被 Immer 冻结的对象暴露给 SDK。

- **Immer**：解决「state 怎么写」——用可变写法生成不可变更新
- **拷贝**：解决「数据边界」——store 与 SDK 之间不共享引用
