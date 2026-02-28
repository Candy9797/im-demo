# AI 问答页

基于 SSE（Server-Sent Events）的流式 AI 问答页面，支持富文本、代码块、图片展示。

## 路由与入口

- **页面**：`/ai`
- **API**：`POST /api/ai/chat`，body `{ message: string }`
- **导航**：首页 landing 链接「AI 问答」

## 技术实现

### SSE 流式

- API 返回 `text/event-stream`
- 每行 `data: { "content": "..." }`，单字符或短片段
- 结束发送 `data: [DONE]`
- 客户端用 `fetch` + `ReadableStream` 消费，边收边渲染

### 展示组件

| 组件 | 路径 | 说明 |
|------|------|------|
| AIContent | `components/ai/AIContent.tsx` | Markdown 解析入口，复用到各子组件 |
| AICodeBlock | `components/ai/AICodeBlock.tsx` | 代码块：语言标签、复制按钮 |
| AIImage | `components/ai/AIImage.tsx` | 图片：加载态、错误态、懒加载 |

### 内容类型

- **富文本**：ReactMarkdown + remark-gfm + remark-breaks，支持粗体、斜体、链接、列表、引用
- **代码块**：Markdown ``` 语法 → AICodeBlock
- **图片**：Markdown `![alt](url)` → AIImage

## 对接真实 LLM

修改 `src/app/api/ai/chat/route.ts`：

1. 调用 OpenAI / Claude 等 streaming API
2. 将 stream chunks 转为 `data: { content }` 格式
3. 保持现有前端逻辑，无需改动

## 可调参数

- 模拟流式延迟：`setTimeout(r, 20)`（约 20ms/字符）
