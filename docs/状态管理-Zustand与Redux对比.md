# 状态管理：Zustand vs Redux / Jotai，以及本项目为何选 Zustand + Immer + Persist

> 简洁、突出重点、有深度，面向面试或技术选型说明。

---

## 一、Zustand vs Redux

| 维度 | Zustand | Redux |
|------|---------|--------|
| **模型** | 单 store，state + actions 同体，`set`/`get` 直接改 | 单 store，reducer 纯函数，dispatch(action) 驱动，不可变更新 |
| **Provider** | 不需要，create 即用 | 需要 `<Provider store={store}>` 包裹 |
| **样板代码** | 少：一个 create，内联 state 与 action，无 action type/creator | 多：reducer、action types、action creators、combineReducers，或 Redux Toolkit 仍有一层抽象 |
| **中间件** | 中间件链（persist、immer、devtools）包在 create 上，组合灵活 | middleware 链（thunk、persist 等）在 createStore 时注入 |
| **持久化** | persist 中间件 + partialize 选字段 + 自定义 storage（如 IndexedDB），与 store 同构 | 需 redux-persist，配置 reducer 白名单、transform、storage，与 reducer 结构绑定 |
| **订阅粒度** | 组件用 selector 取子集，默认浅比较；`useShallow` 做对象切片浅比较，避免整 store 变就重渲染 | 同 selector（useSelector），但默认 ===，要配合 shallowEqual 或 memo 避免过度渲染 |
| **不可变** | 不强制，配合 Immer 时在 set 内「可变写法」由 Immer 产出新不可变树 | 强制不可变，reducer 内必须返回新对象，或用 Immer 在 createSlice 里写可变 |

**核心区别**：Zustand 是 **store 即 API**，无 Provider、无 dispatch/action 层，适合「单 store、多切片、要持久化、要少样板」的场景；Redux 是 **事件溯源风格**，适合强约束、时间旅行调试、大型团队统一规范。

---

## 二、Zustand vs Jotai

| 维度 | Zustand | Jotai |
|------|---------|--------|
| **模型** | 单 store，一个 create 里集中 state + actions | 原子化：多个 atom，每个 atom 独立，组件按 atom 订阅 |
| **心智** | 一个「大对象」+ 方法，类似 Vuex 的一个 module | 无数小 atom，组合成树，类似 Recoil |
| **持久化** | 内置 persist 中间件，partialize 选字段，自定义 storage 直接接 IndexedDB | 需 atomWithStorage 或第三方，按 atom 存，多 key；整块「消息列表」要自己拆/合 |
| **适用** | 一块集中状态（如 IM 的 auth、connection、messages、phase）希望一次 persist 一部分、自定义引擎 | 状态很分散、按原子粒度持久化、不强调「一个 store 一把持久化」 |

**核心区别**：Zustand 是 **一个 store 管一块业务**，persist 时自然「选一部分字段、一个 key、一个 storage」；Jotai 是 **原子化**，更细粒度订阅，但持久化整块复杂状态（如 messages + conversationId）要自己编排。本项目是「一个 IM 客户端状态块 + 要整块持久化到 IndexedDB」，Zustand 更贴。

---

## 三、本项目为什么用 Zustand 做状态管理

1. **单 store 贴合 IM 客户端状态**  
   客服 IM 状态是一块：认证、连接、会话（phase、messages、queue）、UI（弹窗、引用）。一个 `useChatStore` 集中管理，和 IMClient 事件一一对应（CONNECTED → set connectionState，MESSAGE_RECEIVED → 合并 messages），无需多 store 或 reducer 拆片。

2. **无 Provider，和 Next.js / 多入口兼容**  
   不需要在 layout 包 Provider，弹窗、落地页、/test-ws 等任意入口直接用 `useChatStore`，不依赖组件树。

3. **中间件链：persist + immer 一次配好**  
   `persist(immer((set, get) => ({ ... })))`：persist 负责脱水/补水，partialize 只持久化 messages、conversationId；immer 负责在 set 内用可变写法改嵌套（messages.push、state.messages[i].status = ...），少 spread、少错。Redux 要达成「部分持久化到 IndexedDB + 可变式 reducer」需要更多配置。

4. **持久化与离线恢复强需求**  
   消息列表、当前会话 ID 必须落盘（IndexedDB），刷新/断网后再开要先展示本地再 sync。Zustand persist 支持 **自定义 storage**（`createJSONStorage(() => chatPersistStorage)`），直接接 IndexedDB + 防抖写入，且 partialize 排除 client、token，敏感与体积大的不落盘。

5. **订阅粒度可控**  
   组件用 `useShallow` 选对象切片（如 `{ messages, connectionState }`），只有这些字段变才重渲染；消息流高并发时不会因为 auth 或 UI 小字段变更就整列表重绘。

---

## 四、为什么用 Immer 中间件

- **需求**：消息列表频繁「push 新消息、按 id 更新某条 status/seqId、按 id 删或改」。若手写不可变，每次都要 `[...messages.slice(0,i), { ...messages[i], status }, ...messages.slice(i+1)]`，难写易错。
- **Immer**：在 `set((state) => { ... })` 里拿到 draft，直接 `state.messages.push(msg)`、`state.messages.find(m => m.id === id).status = 'sent'`，Immer 在 set 结束后产出新不可变树并 freeze，既满足不可变（便于 React 与 persist 比较），又写起来像可变。
- **与 persist 配合**：persist 拿到的是 Immer 产出的不可变 state，序列化一致；不会出现「draft 被意外写出」的问题。

---

## 五、为什么用 Persist 中间件

- **需求**：messages、conversationId 要进 IndexedDB，页面加载或 auth_ok 前可先 rehydrate 出本地列表，减少白屏；刷新/关标签后再开不丢会话。
- **partialize**：只持久化 `messages`、`conversationId` 等，不持久化 client（不可序列化）、token（敏感）、大对象，控制体积与安全。
- **自定义 storage**：`chatPersistStorage` 实现 getItem/setItem，内部用 IndexedDB，setItem 防抖 80ms，高并发写入合并为一次，避免卡顿。
- **rehydration 异步**：Zustand 的 rehydrate 是异步的，所以 IMClient 在 auth_ok 且服务端空消息时，会调 `getPersistedChatState()` 直接读 IndexedDB 先展示，不等 rehydrate 完成，减少空白时间。

---

## 六、一句话总结

本项目用 **Zustand** 做状态管理，是因为 IM 客户端状态是「一块集中状态 + 要按需持久化到 IndexedDB + 嵌套更新多」；Zustand 无 Provider、少样板、中间件链（**persist + immer**）一次满足持久化与可变式更新，配合 **useShallow** 控制订阅粒度，比 Redux 轻、比 Jotai 更贴合「单 store 整块持久化」的需求。**Immer** 解决消息列表等嵌套结构的可写式更新，**Persist** 解决离线/刷新恢复与 IndexedDB 定制存储。
