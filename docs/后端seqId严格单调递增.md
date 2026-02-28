# 后端如何保证 seqId 严格单调递增

---

## 一、当前实现（单进程下有效）

**做法**：`server/db.ts` 的 `nextSeqId(convId)`：

```ts
export function nextSeqId(convId: string): number {
  const row = db
    .prepare("SELECT MAX(seq_id) as m FROM messages WHERE conversation_id = ?")
    .get(convId) as { m: number | null };
  return (row?.m ?? 0) + 1;
}
```

- 按会话维度：每个 `conversation_id` 独立计序，取该会话下当前最大 `seq_id`，加 1 作为下一条的 seqId。
- **单进程、单线程**：Node 一次只处理一个 WebSocket 帧；在 `ws-handler` 的 SEND_MESSAGE 循环里，对每条消息先 `nextSeqId(convId)` 再在本轮内 `db.insertMessages(toInsert)`，插入完成后下一条消息再取 next，因此**同一会话内**同一批里拿到的 seq 是 1、2、3…，不会重复。
- **局限**：`nextSeqId` 与 `insertMessages` 不在同一事务里，**多进程 / 多实例**时，两个请求可能同时读到相同的 MAX(seq_id)，得到相同“下一个”，插入后就会出现重复 seq_id，无法保证严格单调。

---

## 二、多进程下如何严格保证单调递增

核心思路：**“取下一序”和“落库”必须在同一把“锁”或同一事务内完成**，避免并发时两个请求拿到同一个“下一序”。

### 方式 1：同一事务内用子查询分配 seq_id（推荐，单机 DB）

在**同一事务**里插入时，用子查询当场算出本行 seq_id，避免先 SELECT MAX 再 INSERT 的间隙被其他请求插队：

```sql
INSERT INTO messages (id, conversation_id, seq_id, ...)
VALUES (
  ?,
  ?,
  (SELECT COALESCE(MAX(seq_id), 0) + 1 FROM messages WHERE conversation_id = ?),
  ...
);
```

- 每条 INSERT 的 seq_id 由当前会话的 MAX(seq_id)+1 决定，且发生在插入的同一语句里，同一会话的并发 INSERT 会被 DB 串行化（行锁/表锁），自然单调。
- 批量插入时，可在同一事务里循环执行多条上述 INSERT，每条都会看到前一条已插入的行，得到 1、2、3…
- **适用**：单机 SQLite / MySQL / PostgreSQL 等，会话内严格单调、实现简单。

### 方式 2：会话级序列表 + 事务

- 建表：`conv_seqs(conv_id PRIMARY KEY, next_seq INTEGER)`，每条消息前在同一事务里：
  - `UPDATE conv_seqs SET next_seq = next_seq + 1 WHERE conv_id = ?`
  - 用更新后的 `next_seq` 作为本条 seq_id 插入 messages。
- 或使用 DB 的 `RETURNING`（如 PostgreSQL）在 UPDATE 后直接返回新值。
- 同一事务内 UPDATE 会锁住该会话行，再 INSERT，保证该会话内单调。

### 方式 3：多实例 + Redis 等外部序列

- 用 Redis：`INCR conv:seq:{convId}` 得到下一序，再写 DB。
- 单调性由 Redis 单线程模型保证；需接受“先 Redis 再 DB”的短暂不一致（如 Redis 已递增但 DB 写入失败需业务重试或补偿）。

---

## 三、小结

| 场景           | 当前实现                         | 严格单调做法 |
|----------------|----------------------------------|--------------|
| 单进程 Node    | `MAX(seq_id)+1` + 逐条插入       | 已满足       |
| 多进程 / 多实例 | 会并发取到相同 next，可能重复   | 事务内子查询分配 seq_id，或会话序列表，或 Redis 等外部序列 |

**一句话**：单进程下当前用「每条消息先 `nextSeqId` 再插入」即可保证同一会话内单调；多进程下要在**同一事务内**用子查询或会话序列表分配 seq_id，或用 Redis 等外部序列，才能保证严格单调递增。
