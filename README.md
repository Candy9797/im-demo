# IM & Multi-Scenario Demo

An **IM demo** with customer support chat, friend/group chat (Mock), i18n shop, and AI/stream demos. Built with **Next.js App Router** and a **framework-agnostic IM SDK** (WebSocket, heartbeat, reconnection, batching, Protobuf).

---

## Project Features

### 1. Customer Support IM (Bot → Agent)

- **Bot phase**: FAQ navigation, keyword auto-reply, handoff to human
- **Queuing**: Real-time queue position and estimated wait
- **Agent phase**: Assigned agent info, full chat (text / emoji / file), typing indicators, read receipts
- **Rich media**: Text, emoji picker, image upload (thumbnail + lightbox), PDF, stickers
- **Status**: Sending → sent → delivered → read; edit & recall with optimistic updates
- **Connection**: Connected / reconnecting / disconnected; heartbeat + Pong timeout; visibility & network recovery

### 2. Friend / Group Chat (Mock)

- **Route**: `/chat` — sidebar (friends & groups), multi-conversation switch
- **Messages**: Per-conversation buckets, virtualized list (`react-virtuoso`)
- **Local-only**: Mock data, no backend; reference reply, reactions, edit, recall

### 3. i18n Shop

- **Routes**: `/shop` → redirects to `/zh/shop` or `/en/shop` (cookie / Accept-Language)
- **Pages**: Product list, filters, search; product detail `/[locale]/shop/[id]`; cart; checkout
- **i18n**: `[locale]` segment, `messages/zh.json` & `en.json`, `IntlProvider`, middleware locale detection
- **Shop2**: `/shop2` — waterfall feed, SSR data from `getProducts`

### 4. Other Demos

- **AI chat**: `/ai` — stream-style UI, markdown/code blocks
- **Stream**: `/stream` — streaming demo
- **History**: `/history` — message history (Mock)
- **test-ws**: `/test-ws` — WebSocket debug (real WS, no Mock)
- **demo-protobuf**: Protobuf frame encode/decode demo
- **stress**: High-QPS / stress test page
- **demo/server-actions**: Next.js Server Actions demo

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Next.js App Router                          │
│  layout.tsx (Server) → metadata, globals.css, QueryProvider   │
│  [locale]/layout.tsx → IntlProvider (shop i18n)               │
└───────────────────────────┬─────────────────────────────────┘
                            │ Client boundary ('use client')
┌───────────────────────────▼─────────────────────────────────┐
│                    UI Layer (React)                           │
│  ChatWidget/ChatWindow │ ChatSession* │ Shop* │ LandingHero   │
│            │                    │              │              │
│            ▼                    ▼              ▼              │
│  ┌──────────────┐    ┌──────────────────┐  ┌─────────────┐  │
│  │  chatStore   │    │ chatSessionStore │  │  cartStore   │  │
│  │ (IM + persist)│   │ (friend/group)   │  │  (shop)      │  │
│  └──────┬───────┘    └──────────────────┘  └─────────────┘  │
└─────────┼────────────────────────────────────────────────────┘
          │
┌─────────▼────────────────────────────────────────────────────┐
│                  SDK (framework-agnostic)                    │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ TIM (optional) — unified API layer                      │ │
│  │ IMClient — session, sendMessage, loadHistory, events     │ │
│  └────┬──────────────────────────────────┬─────────────────┘ │
│       ▼                                   ▼                   │
│  ┌──────────────┐              ┌─────────────────────┐       │
│  │ WebSocket     │              │   MessageQueue      │       │
│  │ Manager       │              │   batching, dedup,  │       │
│  │ heartbeat,    │              │   retry, pause      │       │
│  │ reconnect,    │              └─────────────────────┘       │
│  │ Pong timeout  │                                              │
│  └──────┬────────┘              serializer (JSON/Protobuf)     │
│         ▼                                                      │
│  EventEmitter (pub/sub)                                        │
└───────────────────────────────────────────────────────────────┘
```

- **Store**: `chatStore` (customer IM, IndexedDB persist), `chatSessionStore` (friend/group Mock), `cartStore` (shop). See `src/store/README.md`.
- **SDK**: `IMClient` holds `WebSocketManager` + `MessageQueue`; events drive store updates.

---

## Main Routes

| Route | Description |
|-------|-------------|
| `/` | Landing + floating chat entry (Help & Support) |
| `/chat` | Friend/group chat (Mock), sidebar + virtuoso list |
| `/shop` | Redirects to `/zh/shop` or `/en/shop` |
| `/[locale]/shop` | Shop list (i18n), filters, search |
| `/[locale]/shop/[id]` | Product detail |
| `/[locale]/shop/cart` | Cart |
| `/[locale]/shop/checkout` | Checkout |
| `/shop2` | Waterfall shop (SSR) |
| `/ai` | AI chat demo |
| `/stream` | Stream demo |
| `/history` | Message history (Mock) |
| `/test-ws` | WebSocket debug |
| `/demo-protobuf` | Protobuf demo |
| `/stress` | Stress test |
| `/demo/server-actions` | Server Actions demo |

---

## Key Design

### SDK (Bottom-up)

- **EventEmitter**: Typed pub/sub; `on` / `once` / `off`, unsubscribe returned.
- **WebSocketManager**: State machine, exponential backoff reconnection, heartbeat (Ping + Pong timeout), visibility/online recovery; frame protocol with seq.
- **MessageQueue**: Batching, dedup, retry, backpressure, pause on disconnect.
- **IMClient**: `connect`, `sendMessage`, `sendFile`, `selectFAQ`, `requestHumanAgent`, `loadHistory`, sync; phase: BOT → QUEUING → AGENT → CLOSED; emits SDKEvent for store.
- **TIM** (optional): Unified API over IMClient for different frontends.
- **serializer**: JSON (default) and Protobuf; large frames chunked (e.g. 64KB).

### Protocol

Each WebSocket frame: `{ type, seq, timestamp, payload }`. Seq enables ordering, dedup, gap detection, idempotent retry.

### State

- **Zustand + Immer**: `set(fn)` with draft for nested updates; minimal boilerplate.
- **Persist** (chatStore only): IndexedDB via `chatPersistStorage` (debounced); partialize `messages` + `conversationId`; merge by max seqId to avoid stale rehydration.

### i18n (Shop)

- Middleware: `/shop` → `/[locale]/shop` using cookie or Accept-Language.
- `[locale]` layout loads `messages/{locale}.json` and wraps with `IntlProvider`.
- Script: `pnpm run i18n:translate` for message translation.

---

## Quick Start

```bash
# Install
pnpm install

# Run (IM server :3001 + Next.js :3000)
pnpm run dev
```

> **若打开聊天提示「IM 后端未启动」 **：请执行 `pnpm run dev`（同时启动前端 3000 + 后端 3001），不要只跑 `next dev`。

If ports are in use:

```bash
lsof -ti:3000 | xargs kill -9
lsof -ti:3001 | xargs kill -9
pnpm run dev
```

Open **http://127.0.0.1:3000** — click “Help & Support” to start chat (guest login available).

---

## Tech Stack

- **Next.js** (App Router, latest)
- **React 19** + TypeScript
- **Zustand** (state) + **Immer** (draft updates)
- **TanStack React Query**
- **react-virtuoso** (virtualized message list)
- **react-markdown** (AI/stream content)
- **Protobuf** (optional SDK serialization)
- **ethers** + **SIWE** (wallet auth)
- **Custom IM SDK** (no third-party IM lib)
- **i18n**: custom (`messages/`, IntlProvider, middleware)

---

## Project Structure (Overview)

```
src/
├── app/
│   ├── layout.tsx              # Root layout, QueryProvider
│   ├── page.tsx                # Home (LandingHero + ChatWidget)
│   ├── globals.css
│   ├── [locale]/               # i18n segment
│   │   ├── layout.tsx          # IntlProvider
│   │   └── shop/               # /zh/shop, /en/shop
│   │       ├── page.tsx        # List
│   │       ├── [id]/page.tsx   # Detail
│   │       ├── cart/page.tsx
│   │       └── checkout/page.tsx
│   ├── chat/page.tsx           # Friend/group chat
│   ├── shop2/                  # Waterfall shop (SSR)
│   ├── ai/, stream/, history/, test-ws/, stress/, demo*/
│   └── api/                    # auth, shop/products, ai/chat, rate-limit
├── sdk/                        # IM SDK
│   ├── TIM.ts                  # Unified API (optional)
│   ├── IMClient.ts
│   ├── WebSocketManager.ts
│   ├── MessageQueue.ts
│   ├── EventEmitter.ts
│   ├── serializer.ts           # JSON / Protobuf, chunking
│   ├── types.ts
│   └── index.ts
├── store/
│   ├── chatStore.ts            # Customer IM (persist)
│   ├── chatSessionStore.ts     # Friend/group Mock
│   └── README.md               # Store docs
├── stores/
│   └── cartStore.ts            # Shop cart
├── components/                 # Chat, chat session, shop, ai, shared
├── lib/                        # i18n, siwe, chatPersistStorage, shop/getProducts
├── hooks/
├── messages/                   # zh.json, en.json
└── middleware.ts               # /shop → /[locale]/shop
server/                         # Express + WebSocket (port 3001)
```

---

## Production-Oriented Notes

Already in place: WebSocket server, API routes (auth, shop, ai), message persist (IndexedDB), virtual list (react-virtuoso), i18n (shop), rate-limit API.

Further work for production could include: Redis pub/sub for multi-instance WS, DB-backed message history and search, S3/CDN for uploads, E2E encryption, push (Service Worker), and stricter rate limiting.
