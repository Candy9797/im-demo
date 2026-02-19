# Zustand useShallow 分析与面试要点

> 针对 `import { useShallow } from 'zustand/react/shallow'` 的原理、使用注意事项及常见面试题整理。

---

## 一、useShallow 工作原理

### 1.1 源码

```js
// zustand/react/shallow.js
function useShallow(selector) {
  const prev = React.useRef(void 0);
  return (state) => {
    const next = selector(state);  // 1. 执行 selector 得到新对象
    return shallow.shallow(prev.current, next) ? prev.current : prev.current = next;  // 2. 浅比较
  };
}
```

### 1.2 工作机制

1. **返回增强 selector**：`useShallow` 不是 hook，而是接收 selector 返回新的 selector
2. **浅比较**：用 `shallow.shallow(prev, next)` 比较 selector 返回的对象
3. **引用复用**：若浅比较相等 → 返回 `prev.current`，Zustand 认为无变化 → 不触发重渲染；否则更新 `prev.current = next` 并返回新对象，触发重渲染

### 1.3 shallow 比较逻辑（zustand/vanilla/shallow）

- `Object.is(valueA, valueB)` 相同 → 认为相等
- 普通对象：对顶层 key 逐个用 `Object.is` 比较 value
- 数组、Map、Set：比较 length/size，且每项引用 `Object.is`
- 不递归：只比较一层

---

## 二、为什么需要 useShallow？

### 2.1 直接 selector 的问题

```ts
// ❌ 问题写法
const { messages, loadMoreHistory } = useChatStore((s) => ({
  messages: s.messages,
  loadMoreHistory: s.loadMoreHistory,
}));
```

- selector 每次返回**新对象** `{ messages, loadMoreHistory }`
- 即使 `messages`、`loadMoreHistory` 未变，引用变了
- Zustand 默认用 `Object.is` 比较 selector 返回值 → 每次不等 → 每次重渲染

### 2.2 使用 useShallow 后

```ts
// ✅ 推荐写法
const { messages, loadMoreHistory } = useChatStore(
  useShallow((s) => ({
    messages: s.messages,
    loadMoreHistory: s.loadMoreHistory,
  }))
);
```

- 浅比较：只有 `messages` 或 `loadMoreHistory` 引用变化时才视为变化
- 其他 store 字段（如 `phase`、`queue`）变化时，该组件**不会**重渲染

---

## 三、Zustand 使用注意事项

| 要点 | 说明 |
|------|------|
| **1. 多字段订阅必用 useShallow** | 返回对象时，`useShallow` 做浅比较；否则每次都重渲染 |
| **2. 单一字段可不用** | `useChatStore((s) => s.messages)` 直接比较引用，无需 useShallow |
| **3. 只选需要的字段** | 不选的字段变化不会触发重渲染（浅比较只看选中的） |
| **4. action 引用要稳定** | store 内 `set((s) => ({ ... }))` 不要每次新建 action，否则浅比较失效 |
| **5. 与 Immer 配合** | push 等操作要拷贝（如 `{ ...message }`），避免与外部共享引用被 Immer freeze |
| **6. 无 Provider** | Zustand 通过模块级 store 订阅，不依赖 React Context |
| **7. 服务端渲染** | 注意 store 单例，避免请求间污染，必要时用 `createStore` + 初始化 |

### 3.1 常见错误

```ts
// ❌ 每次返回新数组，浅比较失败
useChatStore(useShallow((s) => ({
  ids: s.messages.map(m => m.id),  // 每次新数组
})));

// ✅ 直接订阅原始数据，或 selector 只返回稳定引用
useChatStore(useShallow((s) => ({ messages: s.messages })));
```

---

## 四、常见面试题

### Q1：useShallow 是干什么的？解决什么问题？

**答**：对 selector 返回对象做**浅比较**。多字段 selector 每次返回新对象 `{ a, b }`，引用总变，导致无意义重渲染。`useShallow` 包装后，只有顶层字段引用变化时才触发重渲染。

---

### Q2：Zustand 和 Redux 有什么区别？

| 对比 | Zustand | Redux |
|------|---------|-------|
| API | `create` + `useStore` | `createStore` + `useSelector` |
| 样板代码 | 少 | 多（action/reducer） |
| 中间件 | 可选 | 常用 |
| 性能 | 细粒度订阅，无 Provider | 需 selector 优化 |
| DevTools | 支持 | 支持 |

---

### Q3：如何减少 Zustand 带来的重渲染？

- 只订阅需要的字段
- 多字段时用 `useShallow`
- 单一字段直接用 `(s) => s.xxx`
- 必要时拆分 store，避免大对象变化波及无关组件

---

### Q4：Zustand 的 selector 比较机制？

- 默认用 `Object.is(prev, next)` 比较 selector 返回值
- 返回对象时，每次都是新引用 → 必重渲染
- `useShallow` 用浅比较，只有选中字段引用变化才更新

---

### Q5：为什么和 Immer 一起用时，push 消息要 `{ ...message }`？

Immer 会对 produce 产出的新 state 做 `Object.freeze`。若直接 `push(message)`，Store 和 IMClient 共享同一引用，freeze 后 IMClient 无法再改该对象（如 ACK 时更新 id、status），会静默失败。拷贝 `{ ...message }` 后，Store 持有独立副本，freeze 不影响 IMClient 侧。

---

### Q6：useShallow 的浅比较具体怎么做？

- 比较顶层 key：`Object.entries` 遍历，key 相同且 `Object.is(valueA, valueB)` 才认为相等
- 数组、Map、Set：比较 length/size 和每项引用
- 不递归，只比较一层

---

## 五、项目中的典型用法

```ts
// 多字段订阅
const { phase, queue } = useChatStore(
  useShallow((s) => ({ phase: s.phase, queue: s.queue }))
);

// 单字段订阅，可不用 useShallow
const replyToMessage = useChatStore((s) => s.replyToMessage);
```
