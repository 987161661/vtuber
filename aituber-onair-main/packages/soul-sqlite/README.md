# @aituber-onair/soul-sqlite

Durable SQLite storage for `@aituber-onair/soul`. It uses Node.js's built-in
`node:sqlite`, WAL journaling, full synchronous durability, atomic ledger and
outbox commits, and lease-based delivery retries.

Requires Node.js 24.2 or newer.

```ts
import { SqliteSoulStore } from '@aituber-onair/soul-sqlite';

const store = new SqliteSoulStore({ filename: './data/soul.db' });
const now = Date.now();

await store.commit({
  entries: [ledgerInput],
  outbox: [{
    protocolVersion: '1.0',
    id: 'delivery-1',
    topic: 'speech',
    payload: { kind: 'speech' },
    createdAt: now,
  }],
});

const deliveries = await store.leaseOutbox({
  owner: 'worker-1',
  now,
  limit: 10,
  leaseMs: 30_000,
});

await store.acknowledgeOutbox(deliveries[0].id, 'worker-1', Date.now());
store.close();
```

Use one `SqliteSoulStore` per database process boundary. The store serializes
writes and assigns ledger sequences inside the transaction.
