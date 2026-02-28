 # 虚拟列表原理：千轮对话 + DOM 恒定 < 20

> 基于 react-virtuoso 与项目 MessageList 实现，说明「千轮对话、DOM 节点恒定 < 20」是如何实现的。

## 一、核心思路：Windowing（窗口化）

虚拟列表的本质是 **Windowing**：

- 数据有 1000 条，但**只渲染「当前可见」的那一小段**
- 其余通过 **占位空间（spacer/padding）** 撑开，保证总高度正确、滚动条行为正常

---

## 二、项目中的使用

```tsx
// MessageList.tsx
<Virtuoso
  data={messages}           // 可能上千条
  overscan={OVERSCAN}       // 5 - 视口外多渲染 5 条
  itemContent={itemContent} // 每条消息的渲染
  computeItemKey={(_, msg) => msg.id}
  ...
/>
```

- `data={messages}`：全量消息数据
- `overscan={5}`：视口上下各多渲染约 5 条，避免快速滚动时出现空白
- **实际挂载的 DOM 只有「视口内 + overscan」的若干条**，与总条数无关

---

## 三、react-virtuoso 如何实现 DOM 恒定

### 1. 结构：padding + 可见项 + padding

源码中的列表 DOM 结构（来自 `index.mjs` 及类型定义）：

```
┌─────────────────────────────────────┐
│   padding-top (spacer)              │  ← 上方未渲染消息的总高度
├─────────────────────────────────────┤
│   Item [startIndex]                 │
│   Item [startIndex+1]               │
│   ...                               │  ← 只渲染可见窗口内的项
│   Item [endIndex]                   │
├─────────────────────────────────────┤
│   padding-bottom (spacer)           │  ← 下方未渲染消息的总高度
└─────────────────────────────────────┘
```

- **上方**：用 `padding-top` 或等价 div 撑出「上方所有未渲染项」的高度
- **中间**：只渲染 `startIndex` ~ `endIndex` 的若干条
- **下方**：用 `padding-bottom` 撑出「下方未渲染项」的高度

总 scrollHeight 接近所有消息高度之和，但**实际 DOM 只有中间那一小段**。

### 2. 可见范围计算（简化逻辑）

```
scrollTop = 当前滚动位置
viewportHeight = 可视区域高度
overscan = 5

基于尺寸树 AATree（记录每条 item 的 offset、size）：
  [startOffset, endOffset] = 根据 scrollTop、viewportHeight、overscan 计算的像素范围
  startIndex、endIndex = 在 AATree 中查找该范围内包含的 item 索引

实际渲染：items[startIndex .. endIndex]
```

DOM 数量 ≈ **视口内条数 + 2 × overscan**。例如视口内约 10 条、overscan 5，则约 20 条，对应「DOM 恒定 < 20」的说法。

### 3. 可变高度：尺寸树（AATree）+ ResizeObserver

react-virtuoso 不假设固定行高，支持每条消息高度不同的聊天场景：

| 机制 | 说明 |
|------|------|
| **尺寸树（AATree）** | 内部用 AATree（自平衡树）维护每条 item 的 offset 和 size，支持按范围快速查询 |
| **ResizeObserver** | 监听已渲染 item 的 DOM 尺寸变化（文字换行、图片加载、样式变化等），实测高度写入尺寸树 |
| **首次渲染** | 未知高度时用 `defaultItemHeight` 或首项测量值估算占位，避免布局塌陷 |
| **更新流程** | 尺寸变化 → 更新 AATree → 重算 visibleRange、paddingTop/paddingBottom → 保持滚动条与真实列表一致 |

**实现要点**：
- `sizeSystem.ts`：AATree 维护 offset/size
- `useChangedListContentsSizes`：ResizeObserver 监听已渲染 item，更新 sizes 流
- 注意：item 上用 `margin` 会导致测量不准（contentRect 不含 margin），建议用 `padding`

---

## 四、与本项目的对应关系

| 概念 | 本项目 | react-virtuoso 的作用 |
|------|--------|------------------------|
| 数据源 | `messages`（可上千条） | 只负责读取，不全部渲染 |
| 可见项 | 视口内的消息 | 按 scrollTop + viewport + overscan 计算 `[start, end]` |
| DOM 数量 | 恒定在 ~20 以内 | 只挂载 `items[start..end]`，其余用 padding 占位 |
| overscan | 5 | 上下各多渲染几条，减少快速滚动时的空白 |

结论：千轮对话时，`messages` 可以很大，但实际渲染的 DOM 只有「当前窗口 + overscan」，数量基本恒定，从而实现高性能。
