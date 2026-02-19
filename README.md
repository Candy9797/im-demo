# IM Demo - Customer Support Chat System

A production-grade **Instant Messaging (IM)** demo for a Web3 exchange, inspired by Binance's customer support system. Built from scratch (0→1) with **Next.js App Router** to demonstrate deep IM architecture knowledge, React/Next.js proficiency, and high-QPS handling patterns.

## Demo Features

### 1. Smart Assistant Phase (Bot)
- Self-service FAQ navigation with categorized quick-action buttons
- Auto-response engine with keyword matching
- Seamless handoff to human agents

### 2. Human Agent Phase
- Queue system with real-time position tracking
- Agent assignment with ID/name display (e.g., "Customer Service #1024")
- Slack-like minimalist chat interface

### 3. Rich Media Support
- Text messages with emoji picker
- Image upload with thumbnail preview & lightbox
- PDF document sharing with file metadata display
- Message delivery status indicators (sending → sent → delivered → read)

### 4. Real-time Communication
- Typing indicators (bot & agent)
- Connection state management (connected/reconnecting/disconnected)
- Optimistic UI updates

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              Next.js App Router (SSR/SSG)              │
│  ┌──────────────────────────────────────────────────┐ │
│  │ layout.tsx (Server) → metadata, global styles     │ │
│  │ page.tsx (Server)   → static shell, SEO           │ │
│  └───────────────┬──────────────────────────────────┘ │
│                  │ Client Boundary ('use client')      │
│  ┌───────────────▼──────────────────────────────────┐ │
│  │           UI Layer (React Client Components)      │ │
│  │  ┌──────────┐ ┌───────────┐ ┌────────────────┐  │ │
│  │  │ChatWindow│ │MessageList│ │ InputArea       │  │ │
│  │  └────┬─────┘ └─────┬─────┘ └──────┬─────────┘  │ │
│  │       └─────────────┼──────────────┘             │ │
│  │                     ▼                             │ │
│  │           ┌─────────────────┐                     │ │
│  │           │  Zustand Store  │ (State Bridge)      │ │
│  │           └────────┬────────┘                     │ │
│  └────────────────────┼─────────────────────────────┘ │
└───────────────────────┼───────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────┐
│               SDK Layer (Framework-agnostic)           │
│  ┌────────────────────────────────────────────────┐  │
│  │              IMClient                          │  │
│  │  - Public API (sendMessage, connect)           │  │
│  │  - Event emission (pub/sub)                    │  │
│  │  - Conversation state machine                  │  │
│  └────┬──────────────────────┬────────────────────┘  │
│       ▼                      ▼                       │
│  ┌──────────────┐  ┌─────────────────────┐          │
│  │ WebSocket    │  │   MessageQueue      │          │
│  │ Manager      │  │                     │          │
│  │ - Reconnect  │  │ - Batch processing  │          │
│  │ - Heartbeat  │  │ - Deduplication     │          │
│  │ - Frames     │  │ - Retry w/ backoff  │          │
│  │ - Exp backoff│  │ - Throttling        │          │
│  └──────────────┘  └─────────────────────┘          │
│       ▼                                              │
│  ┌──────────────┐                                    │
│  │ EventEmitter │ (Cross-cutting concern)            │
│  └──────────────┘                                    │
└──────────────────────────────────────────────────────┘
```

## Next.js Architecture Decisions

### Server vs Client Component Split

| Layer | Rendering | Why |
|-------|-----------|-----|
| `layout.tsx` | Server | Static shell, metadata, global CSS — no JS shipped |
| `page.tsx` | Server | Static landing content, SEO-friendly |
| `LandingHero` | Client | Needs `useChatStore` for opening chat |
| `ChatWidget` | Client | Entire IM system is interactive — client boundary |
| SDK Layer | N/A | Pure TypeScript, no React dependency |

### Why Next.js?

1. **SSR/SSG** for the landing page → fast initial load, better SEO
2. **App Router** separates server and client concerns clearly
3. **Path aliases** (`@/`) for clean imports
4. **Built-in optimization** — automatic code splitting, image optimization
5. **API Routes** ready for future server-side chat endpoints (e.g., message history, auth)
6. **Production-ready** — built-in caching, compression, static export

---

## Key Design Decisions

### 1. SDK Architecture (Bottom-up)

The SDK is framework-agnostic and could be published as `@company/im-sdk`:

- **EventEmitter**: Typed pub/sub system. Decouples SDK internals from the UI framework. Supports `on`, `once`, `off`, and auto-cleanup via returned unsubscribe functions.

- **WebSocketManager**: Manages the full WebSocket lifecycle:
  - Connection state machine: `DISCONNECTED → CONNECTING → CONNECTED → RECONNECTING`
  - Exponential backoff with jitter for reconnection
  - Heartbeat ping/pong for connection health monitoring
  - Frame-level protocol with sequence numbers for ordering

- **MessageQueue**: Critical for high-QPS scenarios:
  - **Batching**: Groups messages into configurable batch sizes (default 20) with flush intervals (100ms) to reduce render cycles
  - **Deduplication**: Tracks seen message IDs within a time window to prevent duplicates
  - **Retry**: Failed sends retry with exponential backoff (up to 3 attempts)
  - **Backpressure**: Max queue size with drop policy for oldest messages
  - **Pause/Resume**: Queue pauses during disconnection, resumes on reconnect

- **IMClient**: The main orchestrator:
  - Clean public API: `connect()`, `sendMessage()`, `sendFile()`, `selectFAQ()`, `requestHumanAgent()`
  - Conversation phase state machine: `BOT → QUEUING → AGENT → CLOSED`
  - Optimistic updates: Messages appear in UI immediately, status updates follow

### 2. Protocol Design

Every WebSocket frame includes:
```typescript
{
  type: FrameType,     // AUTH, SEND_MESSAGE, HEARTBEAT_PING, etc.
  seq: number,         // Monotonic sequence number for ordering
  timestamp: number,   // Server/client timestamp
  payload: unknown     // Type-specific data
}
```

Sequence numbers enable:
- **Message ordering**: Guarantee display order matches send order
- **Deduplication**: Detect and drop duplicate frames
- **Gap detection**: Identify lost messages for re-request
- **Idempotent retry**: Same seq = same message, safe to retry

### 3. High-QPS Handling

For scenarios like group chats or market data feeds:

1. **Message batching** (MessageQueue): Collect messages over 100ms windows, deliver in batches of 20. Reduces React render cycles from N to ceil(N/20).
2. **Throttled outgoing**: Prevent client from overwhelming the server with rapid sends.
3. **Virtualized list** (production): Would use `react-virtuoso` or `react-window` to render only visible messages. Critical when message count > 1000.
4. **Sequence-based dedup**: Handles network-level duplicates from retries.

### 4. State Management

Zustand was chosen for its:
- Minimal boilerplate (vs Redux)
- Hook-based API (natural React integration)
- Subscriptions with selector-based re-renders (performance)
- Compatible with Next.js client components
- Easy integration with the SDK's event-driven architecture

---

## Conversation Flow

```
User clicks "Help & Support"
        │
        ▼
┌─────────────────────────┐
│     BOT PHASE           │
│ • Welcome message       │
│ • FAQ buttons shown     │
│ • Auto-responses        │
│ • Keyword matching      │
└────────┬────────────────┘
         │ User clicks "Transfer to Human"
         ▼
┌─────────────────────────┐
│     QUEUING PHASE       │
│ • "Connecting..." msg   │
│ • Queue position banner │
│ • Real-time updates     │
│ • Estimated wait time   │
└────────┬────────────────┘
         │ Queue position = 0
         ▼
┌─────────────────────────┐
│     AGENT PHASE         │
│ • Agent name/code shown │
│ • Full chat capability  │
│ • Text, emoji, files    │
│ • Typing indicators     │
│ • Read receipts         │
└─────────────────────────┘
```

---

## Quick Start

```bash
# 1. 安装依赖
npm install

# 2. 启动（会同时启动 IM 后端 3001 + Next.js 前端 3000）
npm run dev
```

**首次运行或端口被占用时**，可先结束占用进程：
```bash
lsof -ti:3000 | xargs kill -9
lsof -ti:3001 | xargs kill -9
npm run dev
```

**访问**：http://127.0.0.1:3000 ，点击「Help & Support」即可开始对话（无需连接钱包）。

## Tech Stack

- **Next.js 16** (App Router, Turbopack)
- **React 19** + TypeScript
- **Zustand** for state management
- **Custom IM SDK** (no third-party IM dependencies)

## Project Structure

```
src/
├── app/                       # Next.js App Router
│   ├── layout.tsx             # Root layout (Server Component)
│   ├── page.tsx               # Home page (Server Component)
│   └── globals.css            # Global styles (Binance dark theme)
├── sdk/                       # IM SDK (framework-agnostic)
│   ├── EventEmitter.ts        # Pub/sub event system
│   ├── WebSocketManager.ts    # WebSocket lifecycle management
│   ├── MessageQueue.ts        # High-QPS message batching
│   ├── IMClient.ts            # Main SDK entry point
│   ├── types.ts               # Type definitions
│   └── index.ts               # Public API exports
├── store/
│   └── chatStore.ts           # Zustand store (Client)
├── components/
│   ├── LandingHero.tsx        # Landing page hero (Client)
│   ├── ChatWidget.tsx         # Chat entry point (Client boundary)
│   ├── ChatWindow.tsx         # Main chat container
│   ├── Header.tsx             # Connection status & agent info
│   ├── QueueBanner.tsx        # Queue position indicator
│   ├── SmartAssistant.tsx     # FAQ navigation pane
│   ├── MessageList.tsx        # Scrollable message area
│   ├── MessageItem.tsx        # Individual message bubble
│   ├── TypingIndicator.tsx    # Typing animation
│   ├── InputArea.tsx          # Text input + toolbar
│   ├── EmojiPicker.tsx        # Emoji grid selector
│   └── FilePreview.tsx        # Image/PDF preview
└── utils/
    ├── constants.ts           # App constants
    └── helpers.ts             # Utility functions
```

## Production Considerations

If this were deployed to production, additional work would include:

1. **Real WebSocket server** (Node.js/Go) with Redis pub/sub for horizontal scaling
2. **Next.js API Routes** for chat history, authentication, file upload endpoints
3. **Message persistence** in database (MongoDB/PostgreSQL) with cursor-based pagination
4. **File upload service** (S3/CDN) with pre-signed URLs
5. **Virtual scrolling** for large message lists (react-virtuoso)
6. **End-to-end encryption** for sensitive conversations
7. **Rate limiting** on both client and server
8. **Message search** with full-text indexing
9. **Push notifications** via Service Workers
10. **Internationalization** (i18n) with `next-intl`
