# API contributor notes

Remote SQLite access uses the current account session: dashboard cookies or the bearer
credential issued by `nib login`. Connection URLs identify a selection and carry no authority.
Every operation checks ownership and the selected deployment.

`POST /api/apps/:appId/sqlite/connections` with `{ "path": "/app.db" }` selects an existing
file relative to the persistent volume root. The response contains `id`, `url`, and
`expiresAt`, plus the selected app, deployment, and path. The returned HTTP base URL
supports Hrana HTTP v2 (`GET v2` and `POST v2/pipeline`).

A same-origin dashboard can query it with the official HTTP client:

```ts
import { createClient } from '@libsql/client/http';

const response = await fetch(`/api/apps/${appId}/sqlite/connections`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ path: '/app.db' }),
});
if (!response.ok) throw new Error('Could not select the database');
const selection = await response.json();
const client = createClient({ url: selection.url });
const result = await client.execute('SELECT name FROM sqlite_schema');
client.close();
```

A CLI integration supplies its existing login credential as `authToken`. No database
credential is generated or embedded in the URL. Browser mutations reject foreign origins.
`DELETE /api/sqlite/connections/:selectionId` invalidates the selection and its streams.

The guest connection is read-only. Use `client.transaction('read')` for a transaction;
write transactions, schema changes, attachments, and extension loading are refused.
Results stop with an error at 1,000 rows or a 64 KiB guest response. Add `LIMIT` and
select fewer columns for larger datasets. Statements have a five-second execution limit.

A selection expires after one hour or an API restart. A stream expires after thirty seconds
without an operation and retains one guest SQLite connection across pipelines. Stops and
redeployments drain its connection. A guest admits four streams; the API admits sixty-four.
Selections and streams live in memory and require requests to reach the same API instance.

The API relays operations to the authenticated host agent; it never opens the volume itself.
The agent wakes an idle guest, protects its active stream from idle capture, and forwards
bounded frames over the SQLite vsock channel. The runtime forks a restricted worker per
connection inside the tenant data directory. Existing databases remain in place, including WAL
sidecars. Files are not copied into the control plane.
