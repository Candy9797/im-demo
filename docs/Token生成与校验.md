# Token 生成与校验

服务端校验的 token 为 JWT，通过 WebSocket URL `?token=xxx` 或 HTTP Header `Authorization: Bearer xxx` 传递。

## 1. 访客 / Demo 登录

**路径**：`GET /api/auth/demo` → 后端 `createDemoAuth()`

**流程**：

1. 随机生成 `address`（0x + 40 位十六进制）
2. `ensureUser(address)` 获取或创建 `userId`
3. `createToken(userId, address)` 签发 JWT
4. 返回 `{ token, userId, address }`

**代码**（server/auth.ts）：

```ts
export function createDemoAuth(): { userId: string; address: string; token: string } {
  const address = `0x${Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
  const userId = ensureUser(address);
  const token = createToken(userId, address);
  return { userId, address, token };
}
```

---

## 2. 钱包登录（SIWE）

**路径**：`POST /api/auth/verify` → 后端 `verifySiweAndIssueToken()`

**流程**：

1. 客户端请求 nonce：`GET /api/auth/nonce?address=xxx`
2. 客户端构造 SIWE 消息，用户用 MetaMask 签名
3. 客户端提交 `{ message, signature }` 到 `POST /api/auth/verify`
4. 服务端校验 nonce、SIWE 签名
5. 校验通过后：`ensureUser(address)` → `createToken(userId, address)`
6. 返回 `{ token, userId, address }`

---

## 3. JWT 生成方式

两种登录方式最终都调用 `createToken`：

```ts
export function createToken(userId: string, address: string): string {
  return jwt.sign({ userId, address }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}
```

| 项 | 说明 |
|----|------|
| Payload | `{ userId, address }` |
| 密钥 | `JWT_SECRET`（默认 `"web3-im-dev-secret-change-in-production"`，生产环境需用环境变量） |
| 过期时间 | `JWT_EXPIRES`，默认 `"24h"` |

---

## 4. Token 校验

**WebSocket 连接**：token 通过 `ws://host:3001/ws?token=xxx` 的 query 传递，服务端在 `handleConnection` 中调用 `verifyToken(token)`。

**HTTP 请求**（上传、搜索等）：token 通过 `Authorization: Bearer xxx` Header 传递。

**校验逻辑**（server/auth.ts）：

```ts
export function verifyToken(token: string): { userId: string; address: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; address: string };
    return decoded;
  } catch {
    return null;
  }
}
```
