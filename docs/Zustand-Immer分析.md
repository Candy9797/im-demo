# Zustand + Immer 分析与优化

## 1. 现状分析

### 1.1 Zustand 使用方式 ✅

- **无 Context**：`chatStore` 和 `chatSessionStore` 直接通过 `create` 创建，无 Provider 包裹
- **直接订阅**：组件通过 `useChatStore()` / `useChatSessionStore()` 订阅
- **结论**：已符合「不依赖 Context，避免不必要的重渲染」的目标

### 1.2 Immer 使用情况 ❌

- **未使用**：`package.json` 中无 `immer` 依赖
- **更新方式**：Store 中大量手动不可变更新，例如：
  - `messages: s.messages.map(...)` 
  - `{ ...m, metadata: { ...meta, reactions: r } }`
  - 嵌套对象的展开复制，代码冗长且易出错

### 1.3 选择器与重渲染 ⚠️

- **问题**：多数组件使用解构订阅整块状态：
  ```ts
  const { messages, loadMoreHistory, ... } = useChatStore()
  ```
  会订阅整个 store，任意 state 变化都会触发重渲染
- **例外**：`MessageItem` 使用 `useChatStore((s) => s.replyToMessage)` 单一选择器，较优

## 2. 优化方案

### 2.1 集成 Immer

- 安装 `immer`（Zustand immer 中间件的 peer dependency）
- 使用 `zustand/middleware/immer` 包装 store
- 将 `set((s) => ({ ... }))` 改为 `set((state) => { state.xxx = ... })` 的可变写法

**示例**（`addReaction` 改造前 vs 后）：

```ts
// 改造前
set((s) => {
  const msg = s.messages.find((m) => m.id === messageId);
  if (!msg) return s;
  const meta = (msg.metadata as { reactions?: Record<string, string[]> }) ?? {};
  const r = { ...(meta.reactions ?? {}) };
  r[emoji] = [...(r[emoji] ?? []).filter((u) => u !== auth.userId), auth.userId];
  return {
    messages: s.messages.map((m) =>
      m.id === messageId ? { ...m, metadata: { ...meta, reactions: r } } : m
    ),
  };
});

// 改造后（Immer）
set((state) => {
  const msg = state.messages.find((m) => m.id === messageId);
  if (!msg) return;
  const meta = (msg.metadata as { reactions?: Record<string, string[]> }) ?? {};
  if (!meta.reactions) meta.reactions = {};
  if (!meta.reactions[emoji]) meta.reactions[emoji] = [];
  meta.reactions[emoji] = meta.reactions[emoji].filter((u) => u !== auth.userId);
  meta.reactions[emoji].push(auth.userId);
});
```

### 2.2 使用 useShallow 优化订阅

- 对于需要多字段的组件，使用 `useShallow` 做浅比较：
  ```ts
  import { useShallow } from 'zustand/react/shallow'
  
  const { messages, loadMoreHistory } = useChatStore(
    useShallow((s) => ({ messages: s.messages, loadMoreHistory: s.loadMoreHistory }))
  )
  ```
- 仅当 `messages` 或 `loadMoreHistory` 引用变化时才重渲染，避免无关 state 变化触发渲染

### 2.3 与 React 18 自动批处理

- Immer 的 `produce` 在单次 `set` 调用中完成更新，产出新的不可变快照
- React 18 的 `startTransition` / 自动批处理与 Zustand + Immer 无冲突，状态更新仍是同步的，批处理照常生效

### 2.4 Immer 冻结与引用隔离

**Immer 会冻结**：`produce` 完成后，Immer 会对生成的新 state 调用 `Object.freeze`，使其不可变，防止外部直接修改。

**为何消息要拷贝**：Store 的 `messages` 与 IMClient 的 `conversation.messages` 不能共享同一对象引用。事件回调收到的 `message` 来自 IMClient，若直接 `state.messages.push(message)`：
1. `message` 与 IMClient 内对象是同一引用
2. Immer 会 freeze 新 state，包括 `message` 在内
3. IMClient 后续更新该消息（如 ACK 后改 id、status）时，对象已被 freeze，修改会静默失败或报错

**正确写法**：`state.messages.push({ ...message })`，拷贝一份新对象再 push，Store 与 IMClient 无共享引用。

| 概念 | 说明 |
|------|------|
| Immer 会冻结 | 对 produce 产出的新 state 做 Object.freeze，不可再修改 |
| 为何要拷贝 | 避免与 IMClient 共享引用，否则 freeze 后 IMClient 无法更新该对象 |

## 3. 改造清单

| 文件 | 改造内容 |
|------|----------|
| `package.json` | 添加 `immer` 依赖 |
| `chatStore.ts` | 使用 immer 中间件，将 `set` 回调改为可变写法 |
| `chatSessionStore.ts` | 同上 |
| `MessageList.tsx`、`ChatWindow.tsx`、`InputArea.tsx` 等 | 使用 `useShallow` 替代整块解构 |
