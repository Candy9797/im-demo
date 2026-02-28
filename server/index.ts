/**
 * IM Backend Server - Express + WebSocket
 * - REST: SIWE auth, nonce, file upload
 * - WebSocket: real-time messaging
 * - GET /stream: 纯 Node renderToPipeableStream 流式 SSR
 */
import express from "express";
import { renderToPipeableStream } from "react-dom/server";
import { createStreamDocument } from "./stream-page";
import cors from "cors";
import path from "path";
import { createServer, type IncomingMessage } from "http";
import { WebSocketServer } from "ws";
import { createNonce } from "./db";
import { verifySiweAndIssueToken } from "./auth";
import { handleConnection, getRateLimitState, getRateLimitConfig } from "./ws-handler";
import { upload, getFileUrl } from "./upload";

const PORT = Number(process.env.PORT) || 3001;
const app = express();

app.use(
  cors({
    origin: [
      process.env.CLIENT_URL || "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:3000",
    ],
    credentials: true,
  })
);
app.use(express.json());

// REST: get nonce for SIWE
app.get("/api/auth/nonce", (req, res) => {
  const address = (req.query.address as string)?.toLowerCase();
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: "Invalid address" });
  }
  const nonce = createNonce(address);
  res.json({ nonce });
});

// REST: demo/guest auth (no wallet required)
app.get("/api/auth/demo", (req, res) => {
  try {
    const { createDemoAuth } = require("./auth");
    const { userId, address, token } = createDemoAuth();
    res.json({ token, userId, address });
  } catch (err) {
    console.error("[demo auth]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Demo auth error" });
  }
});

// REST: verify SIWE and return JWT
app.post("/api/auth/verify", async (req, res) => {
  const { message, signature } = req.body;
  if (!message || !signature) return res.status(400).json({ error: "Missing message or signature" });
  const result = await verifySiweAndIssueToken(message, signature);
  if (!result) return res.status(401).json({ error: "Invalid signature" });
  res.json({ token: result.token, userId: result.userId, address: result.address });
});

// REST: search messages (requires auth)
app.get("/api/search", (req, res) => {
  const auth = req.headers.authorization?.replace("Bearer ", "");
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  const { verifyToken } = require("./auth");
  const payload = verifyToken(auth);
  if (!payload) return res.status(401).json({ error: "Invalid token" });
  const { q, convId, limit } = req.query;
  if (!q || typeof q !== "string") return res.status(400).json({ error: "Missing q" });
  const { searchMessages } = require("./db");
  const rows = searchMessages((convId as string) || "", q, limit ? Number(limit) : 50);
  res.json({ messages: rows });
});

// REST: file upload
app.post("/api/upload", upload.single("file"), (req, res) => {
  const auth = req.headers.authorization?.replace("Bearer ", "");
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  const { verifyToken } = require("./auth");
  if (!verifyToken(auth)) return res.status(401).json({ error: "Invalid token" });
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file" });
  res.json({ url: getFileUrl(file.filename), filename: file.filename });
});

// 流式 SSR：纯 Node renderToPipeableStream，不依赖 Next.js
app.get("/stream", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const { pipe } = renderToPipeableStream(createStreamDocument(), {
    onError(err) {
      console.error("[stream SSR]", err);
    },
  });
  pipe(res);
});

// REST: 限流状态（调试/监控用，Map<userId, number[]>）
app.get("/api/rate-limit-state", (_req, res) => {
  res.json(getRateLimitState());
});

// REST: 限流配置（limitPerSec）
app.get("/api/rate-limit-config", (_req, res) => {
  res.json(getRateLimitConfig());
});

// Static: serve uploaded files
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

/** 从 Sec-WebSocket-Protocol 头解析 JWT（子协议为 im-auth,<token>），避免 URL 泄露；无则回退到 URL query */
function getTokenFromRequest(req: IncomingMessage): string | null {
  const proto = req.headers["sec-websocket-protocol"];
  if (proto) {
    const protocols = proto.split(",").map((s) => s.trim());
    if (protocols[0] === "im-auth" && protocols[1]) return protocols[1];
    if (protocols[0] && protocols[0].startsWith("eyJ")) return protocols[0];
  }
  const url = new URL(req.url ?? "", `http://${req.headers.host}`);
  return url.searchParams.get("token");
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", `http://${req.headers.host}`);
  const token = getTokenFromRequest(req);
  const fresh = url.searchParams.get("fresh") === "1";
  const kickOthers = url.searchParams.get("multi") !== "1";
  const format = (url.searchParams.get("format") === "protobuf" ? "protobuf" : "json") as "json" | "protobuf";
  handleConnection(ws as any, token, fresh, kickOthers, format);
});

(async () => {
  const { initDb } = await import("./db");
  await initDb();
  server.listen(PORT, () => {
    console.log(`[IM Server] HTTP + WS listening on port ${PORT}`);
  });
})();
