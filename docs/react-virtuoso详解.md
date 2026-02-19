# React Virtuoso 详解

> 虚拟滚动 React 组件，用于高效渲染大型列表、网格、表格和 feeds。
> 
> 本文基于 react-virtuoso v4.18.1

---

## 一、组件介绍

`Virtuoso` 是 `react-virtuoso` 的核心组件，专为**扁平列表**设计。同系列还包括：

| 组件 | 用途 |
|------|------|
| `Virtuoso` | 扁平列表 |
| `GroupedVirtuoso` | 分组列表 + 粘性组头 |
| `VirtuosoGrid` | 等尺寸网格 |
| `TableVirtuoso` | 表格行虚拟化 |

---

## 二、解决了什么问题

### 2.1 长列表渲染性能问题
长列表 DOM 过多、首屏慢、滚动卡顿，以及虚拟化如何缓解
若用常规方式渲染 10 万条消息：

```tsx
// ❌ 低效：会创建 10 万个 DOM 节点
{messages.map((msg) => <MessageItem key={msg.id} message={msg} />)}
```

会出现：

- DOM 节点过多，内存占用高
- 首次渲染时间长
- 滚动卡顿
- 布局/重排成本高

### 2.2 Virtuoso 的做法

**虚拟化（Virtualization）**：只渲染可视区域 + 少量 overscan 内的元素，其余用占位高度撑开滚动条。

- 视口内约 10–20 条消息 → 只渲染约 15–25 条（含 overscan）
- DOM 数量与总条数解耦
- 滚动时动态 unmount / mount 不可见元素

---

## 三、工作原理
只渲染可视区域 + overscan 内的 item
用 paddingTop/paddingBottom 模拟总高度
sizeRangeSystem 根据 scrollTop、viewport 计算可见区间
listStateSystem 根据尺寸树（AATree）计算要渲染的 item
ResizeObserver 监听变高 item 的尺寸变化

### 3.1 核心思路

```
┌─────────────────────────────────────┐
│  Scroller（overflow: auto）         │
│  ┌───────────────────────────────┐  │
│  │ Viewport（可视区域）            │  │
│  │  paddingTop（上方占位）         │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │ 只渲染的 Items           │  │  │
│  │  │ Item 5, 6, 7, 8, 9...   │  │  │
│  │  └─────────────────────────┘  │  │
│  │  paddingBottom（下方占位）      │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

1. 通过 `scrollTop`、`viewportHeight` 算出当前可见的像素范围 `[startOffset, endOffset]`
2. 在尺寸树（AATree）中查该范围内包含哪些 item 索引
3. 只渲染这些 item，其余用 `paddingTop` / `paddingBottom` 模拟总高度

### 3.2 尺寸系统（sizeSystem）

- 使用 **AATree** 维护 item 的 offset 和 size
- 支持**变高 item**：不需要预先知道高度
- 使用 **ResizeObserver** 监听每个已渲染 item 的尺寸变化，更新尺寸树

### 3.3 可见范围计算（sizeRangeSystem）

`visibleRange` 由以下输入决定：

- `scrollTop`：当前滚动位置
- `viewportHeight`：视口高度
- `headerHeight` / `topListHeight`：头部、粘性项高度
- `overscan`：上下多渲染的 item 数量
- `increaseViewportBy`：视口上下扩展的像素

根据这些算出 `[startOffset, endOffset]`，再映射到 item 索引区间。

### 3.4 列表状态（listStateSystem）

- 根据 `visibleRange` 和尺寸树，计算需要渲染的 `items` 列表
- 每个 item 包含：`index`、`offset`、`size`、`data`
- 支持 `minOverscanItemCount` 在顶部/底部额外多渲染几个 item

### 3.5 响应式流架构（urx）

内部用 `urx` 做响应式流式状态管理：

- `scrollTop`、`viewportHeight`、`sizes` 等作为流
- 依赖变化时自动重算 `visibleRange` → `listState` → 触发重渲染

---

## 四、使用方式

### 4.1 基础用法

```tsx
import { Virtuoso } from 'react-virtuoso'

// 方式 1：totalCount + itemContent（无 data）
<Virtuoso
  style={{ height: '100%' }}
  totalCount={200}
  itemContent={(index) => <div>Item {index}</div>}
/>

// 方式 2：data + itemContent（带 data，推荐）
<Virtuoso
  style={{ height: '100%' }}
  data={messages}
  itemContent={(index, message) => <MessageItem message={message} />}
  computeItemKey={(_, msg) => msg.id}
/>
```

### 4.2 聊天场景常用配置（以 MessageList 为例）

```tsx
<Virtuoso
  ref={virtuosoRef}
  style={{ height: '100%' }}
  data={messages}
  initialTopMostItemIndex={messages.length - 1}  // 初始滚到底部
  followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}  // 在底部时新消息自动滚底
  atBottomStateChange={(atBottom) => setShowScrollBtn(!atBottom)}  // 是否在底部
  atTopStateChange={(atTop) => atTop && hasMoreHistory && loadMoreHistory()}  // 顶部加载历史
  itemContent={itemContent}
  computeItemKey={(_, msg) => msg.id}
  overscan={5}
  components={{ List: CustomList, Footer: TypingIndicator }}
  className="message-list-virtuoso"
/>
```

### 4.3 常用 Props

| Prop | 说明 |
|------|------|
| `data` | 数据数组，长度决定 totalCount |
| `totalCount` | 总条数（与 data 二选一） |
| `itemContent` | `(index, item) => ReactNode` 渲染单条 |
| `computeItemKey` | `(index, item) => Key` 稳定 key |
| `initialTopMostItemIndex` | 初始顶部可见的 item 索引 |
| `followOutput` | `true \| 'smooth' \| 'auto' \| (isAtBottom) => ...` 新内容追加时是否自动滚到底 |
| `atBottomStateChange` | 是否到达底部的回调 |
| `atTopStateChange` | 是否到达顶部的回调 |
| `overscan` | 视口外多渲染的 item 数量 |
| `components` | 自定义 List、Header、Footer、Item 等 |
| `alignToBottom` | 内容不足一屏时是否靠底对齐 |

### 4.4 VirtuosoHandle 命令式方法

```tsx
const virtuosoRef = useRef<VirtuosoHandle>(null)

// 滚到指定 index
virtuosoRef.current?.scrollToIndex({
  index: messages.length - 1,
  behavior: 'smooth',
})

// 滚到指定像素
virtuosoRef.current?.scrollTo({ top: 0, behavior: 'smooth' })

// 相对滚动
virtuosoRef.current?.scrollBy({ top: 100 })

// 图片加载后再次对齐底部
virtuosoRef.current?.autoscrollToBottom()

// 获取/恢复滚动状态
virtuosoRef.current?.getState((state) => { /* ... */ })
```

---

## 五、源码结构概览

### 5.1 主要模块

- `Virtuoso.tsx`：组件入口、Items 渲染、Header/Footer、Viewport
- `listSystem.ts`：组合 size、scroll、followOutput、listState 等子系统
- `listStateSystem.ts`：根据 visibleRange 和 sizes 计算需渲染的 items
- `sizeRangeSystem.ts`：根据 scrollTop、viewportHeight 计算 visibleRange
- `sizeSystem.ts`：AATree 维护 item 尺寸和 offset
- `domIOSystem.ts`：scrollTop、viewport 等 DOM 状态
- `followOutputSystem.ts`：底部对齐、新内容追加时自动滚动

### 5.2 渲染流程简述

1. Viewport 用 `useSize` 测量自身高度，通过 `viewportHeight` 流传出
2. Scroller 监听 scroll 事件，更新 `scrollTop`
3. `sizeRangeSystem` 用 scrollTop + viewportHeight 算 `visibleRange`
4. `listStateSystem` 用 visibleRange + sizes 算 `listState.items`
5. `Items` 组件遍历 `listState.items` 调用 `itemContent` 渲染
6. 每个 Item 用 ResizeObserver 测量高度，结果写入 sizes 流
7. sizes 变化 → 触发 visibleRange / listState 重算 → 再渲染

### 5.3 变高 item 的处理

- 初次渲染时，未知高度 item 使用 `defaultItemHeight` 或首项测量值估算
- `useChangedListContentsSizes` 用 ResizeObserver 监听已渲染 item 尺寸
- 尺寸变化时更新 sizes → 重算 offset → 更新 paddingTop/paddingBottom
- **注意**：item 上使用 `margin` 会导致测量不准（contentRect 不含 margin），建议用 padding

---

## 六、注意事项与最佳实践

### 6.1 CSS 限制

- 不要在 item 上使用会“伸出”容器外的 margin，否则总高度会算错
- 如需留白，用 padding 代替 margin

### 6.2 性能建议

- 用 `React.memo` 包装 `itemContent` 返回的组件
- 不要把复杂组件内联在 `itemContent` 里，应抽成独立组件
- 图片多时，可配合 `isScrolling` 在滚动中展示占位，停止后再加载
- 通过 `increaseViewportBy` 或 `overscan` 平衡预渲染和性能

### 6.3 聊天场景要点

- `alignToBottom` + `followOutput`：内容靠底、新消息自动滚底
- `initialTopMostItemIndex={data.length - 1}`：初次加载时显示最新消息
- `atTopStateChange`：实现“向上拉加载历史”
- `computeItemKey` 用消息 id，避免列表重排时 key 混乱

---

## 七、与本项目的 MessageList 对应关系

`MessageList.tsx` 中的 Virtuoso 配置对应关系：

| 配置 | 作用 |
|------|------|
| `data={messages}` | 消息列表数据源 |
| `initialTopMostItemIndex={messages.length - 1}` | 进入会话时滚到底部 |
| `followOutput={(isAtBottom) => isAtBottom ? 'smooth' : false}` | 在底部时新消息平滑滚到底 |
| `atBottomStateChange` | 控制“回到底部”按钮显隐 |
| `atTopStateChange` | 向上滚动到顶时加载更多历史 |
| `itemContent` | 渲染 `MessageItem`，并传入 showAvatar、onVisible 等 |
| `computeItemKey={(_, msg) => msg.id}` | 用消息 id 作 key |
| `overscan={5}` | 视口外多渲染 5 条，减少白屏 |
| `components={{ List, Footer }}` | 自定义列表容器和底部打字指示器 |

---

## 参考

- [官方文档](https://virtuoso.dev/react-virtuoso/)
- [API Reference](https://virtuoso.dev/react-virtuoso/api-reference/)
- [GitHub](https://github.com/petyosi/react-virtuoso)
