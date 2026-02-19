/**
 * AI 问答 SSE 流式接口
 *
 * POST body: { message: string }
 * 返回: text/event-stream，每行 data: { type, content } 或 data: [DONE]
 *
 * 可后续对接 OpenAI / Claude 等，当前为模拟流式响应
 */
import { NextRequest } from "next/server";

const encoder = new TextEncoder();

/** 流式 chunk 类型：thought=思维链，answer=最终答案 */
type StreamChunk =
  | { type: "thought"; content: string }
  | { type: "answer"; content: string };

/** 模拟 AI 回复（含 CoT 思维链，生产环境对接 Claude/OpenAI reasoning） */
async function* mockStreamResponse(
  userMessage: string,
): AsyncGenerator<StreamChunk> {
  const responses: Record<string, string> = {
    hello: "Hello! How can I help you today?",
    code: `Here's a sample code block:

\`\`\`javascript
function greet(name) {
  return \`Hello, \${name}!\`;
}
console.log(greet("World"));
\`\`\`

You can run this in Node.js or browser.`,
    image:
      "Here's an example image:\n\n![Ethereum](https://ethereum.org/static/0a7d83ec646d64ac7073e9c6d72c0156/ethereum-icon-purple.png)",
    markdown: `**Markdown** supports *italic*, \`code\`, and more:

- List item 1
- List item 2

> Blockquote example`,
  };

  /** 全量展示 mock：思维链 + 富文本 + 代码 + 图片，文案加长 */
  const demoThought = `用户发来了消息，需要分析并给出回复。

首先理解需求：用户希望看到完整的界面展示效果，包括思维链（Chain of Thought）的实时打字效果，以及丰富的文案内容。

接下来规划回复结构：
1. 思维链区块：展示推理过程，让用户感受到「正在思考」的沉浸感
2. 富文本区块：包含 Markdown 粗体、斜体、行内代码、有序列表、引用等
3. 代码块：展示 TypeScript 示例，带语法高亮和复制按钮
4. 图片区块：展示网络图片的加载态与渲染

最后组织语言，确保内容充实、层次分明。开始输出...`;

  const demoAnswer = `下面是 **完整组件展示**，文案已加长以便更好地观察打字效果：

## 富文本能力

本回答支持多种 Markdown 格式，包括：
- *斜体文字* 用于强调
- **粗体文字** 用于重点
- \`行内代码\` 用于技术术语

同时支持有序列表、无序列表和引用块，让回复结构清晰易读。

## 列表与引用

**无序列表示例：**
- 第一项内容
- 第二项内容
- 第三项内容

**引用块示例：**
> 这是一段引用文字，通常用于突出重要观点或他人原话。

## 代码块展示

以下是 TypeScript 求和函数的示例，支持语法高亮与一键复制：

\`\`\`typescript
function sum(a: number, b: number): number {
  return a + b;
}
const result = sum(1, 2);
console.log(result); // 输出: 3
\`\`\`

## 图片展示

下方是一张网络图片，展示加载态与加载完成后的渲染效果：

![Ethereum](https://ethereum.org/static/0a7d83ec646d64ac7073e9c6d72c0156/ethereum-icon-purple.png)

---

以上就是思维链、富文本、代码块、图片等组件的完整展示，打字效果会逐字呈现，方便观察流式输出的表现。`;

  const trimmed = userMessage.trim();
  const lower = trimmed.toLowerCase();
  const isDemo =
    lower === "展示效果" ||
    lower === "demo" ||
    lower.includes("展示效果") ||
    lower.includes("demo") ||
    lower.includes("展示") ||
    lower.includes("全量") ||
    lower.includes("效果");

  let thoughtContent: string;
  let answerContent: string;

  if (isDemo) {
    thoughtContent = demoThought;
    answerContent = demoAnswer;
  } else {
    const content = lower.includes("code")
      ? responses.code
      : lower.includes("image")
        ? responses.image
        : lower.includes("markdown") || lower.includes("md")
          ? responses.markdown
          : lower.includes("hello") || lower.includes("hi")
            ? responses.hello
            : null;

    if (content) {
      const thoughtEnd = Math.floor(content.length * 0.4);
      thoughtContent = content.slice(0, thoughtEnd);
      answerContent = content.slice(thoughtEnd);
    } else {
      thoughtContent = demoThought;
      answerContent = demoAnswer;
    }
  }

  /** 打字效果：逐字输出，间隔 25ms，便于观察流式动画 */
  const CHUNK_SIZE = 1;
  const DELAY_MS = 25;

  for (let i = 0; i < thoughtContent.length; i += CHUNK_SIZE) {
    yield { type: "thought", content: thoughtContent.slice(i, i + CHUNK_SIZE) };
    if (i + CHUNK_SIZE < thoughtContent.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
  for (let i = 0; i < answerContent.length; i += CHUNK_SIZE) {
    yield { type: "answer", content: answerContent.slice(i, i + CHUNK_SIZE) };
    if (i + CHUNK_SIZE < answerContent.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
}

export async function POST(req: NextRequest) {
  let body: { message?: string } = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
    });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return new Response(JSON.stringify({ error: "message is required" }), {
      status: 400,
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: { type?: string; content?: string } | string) => {
        const payload = typeof obj === "string" ? obj : JSON.stringify(obj);
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };

      try {
        for await (const chunk of mockStreamResponse(message)) {
          send(chunk);
        }
        send("[DONE]");
      } catch (e) {
        console.error("[ai/chat]", e);
        send(JSON.stringify({ error: "Stream error" }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
