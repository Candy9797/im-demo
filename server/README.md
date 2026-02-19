# IM Backend - High Concurrency Design

## Current Optimizations

### Database (SQLite)
- **WAL mode**: Enables concurrent reads during writes
- **busy_timeout**: 5s - wait on lock instead of immediate failure
- **synchronous = NORMAL**: Balance between safety and performance
- **Prepared statements**: Reused for hot paths (create conv, insert message)

### WebSocket
- Single process, async I/O - Node.js handles many concurrent connections efficiently
- Stateless design: session state in DB, clients map only for routing

## Scaling for Higher Concurrency

1. **PostgreSQL + connection pool**: Replace SQLite with `pg` + `pg-pool` for multi-writer
2. **Redis**: Session/connection mapping for horizontal scaling
3. **Cluster mode**: Multiple Node workers + sticky sessions or Redis pub/sub for WS message fan-out
4. **Message queue**: Kafka/RabbitMQ for async message processing if needed

## Dual-Session Architecture

- **Bot session** (`conv-bot-*`): User ↔ Smart Assistant (FAQ)
- **Agent session** (`conv-agent-*`): User ↔ Human (or simulated agent)
- On "转人工": new agent conv created, client switches via `SESSION_SWITCHED` frame
