# Local product HTTP contract v1

The server binds only `127.0.0.1`. Browser requests use that exact origin/Host; write requests require the matching `Origin` and JSON content type (DELETE has no body). There is one OS-local owner, `local-owner`, no claimed multi-user isolation and no browser-supplied identity. All strings are plain text, never trusted HTML. Errors are `{error:{code,message}}` with an appropriate HTTP 4xx/5xx.

- `GET /api/state`: `{product:{name,description,domain,mode,owner,configuration:{ready,message}},revision,records,runs,activeRunId}`. No credentials or system prompt. `ready` means configuration is present, not platform verification.
- `POST /api/records`: `{title,content,source?,clientRequestId?}` → 201 `{record}`. Reuse the same `clientRequestId` for retrying an identical save; different content gives 409. Title 1–160, content 1–6000, source 0–200 trimmed characters. Maximum JSON body 32 KiB. Record `{id,title,content,source,status,createdAt,updatedAt}`.
- `PATCH /api/records/:id`: nonempty subset `{title,content,source,status}` → `{record}`; `status` is `new|reviewed|resolved`. Input snapshots of earlier analyses remain unchanged.
- `DELETE /api/records/:id`: no body → `{deleted:true}`. Also deletes all analyses quoting this record, including input snapshots; UI must explain this before action. A record used by the active run returns 409 until the run ends. No artificial seed data is inserted.
- `POST /api/runs`: `{recordIds?:string[]}` → 202 `{run}`. Missing IDs selects all current records; require 1–50 unique IDs. Only one run at a time; 409 `busy` on concurrent submissions. Unknown fields including owner IDs are rejected. Retrying this POST creates a new potentially paid run, so first reconcile unknown responses with `GET /api/state`.
- `POST /api/runs/:id/cancel`: `{}` → `{run}`; `cancelling` means cleanup is pending, `cancelled` means resources settled. Cancelling an already terminal run is idempotent.
- `GET /api/runs/:id/events`: standard SSE `id: N` plus `data: JSON`; use EventSource `onmessage`. Every JSON value contains `{id:number,type,runId,time}`. `Last-Event-ID` or `?after=N` resumes a bounded live buffer; completion can be reconstructed from durable run state. Client closes EventSource on `done`.

Event extra fields:

| type | fields | meaning |
|---|---|---|
| progress | `message?`, `text?`, `replace?`, `status?` | `text` is an uncommitted display delta; `replace:true` clears provisional text after retraction. Never store this as the authoritative result. |
| tool | `name`, `recordIds`, `message` | Actual server-side business-tool execution, scoped to selected inputs. |
| result | `result:{text,readIds,toolCalls}` | SDK completed, resource receipt passed, and result was durably stored. |
| error | `error:{code,message}` | Safe failure message, never raw provider errors. |
| done | `status` | Terminal run; refresh state and stop SSE. |

Run: `{id,status,mode,recordIds,inputRecords,createdAt,finishedAt?,result?,error?}`. Mode is `offline|platform`. Status is `running|cancelling|completed|failed|cancelled|interrupted`; terminal runs survive restart, while previously active runs become `interrupted`, never silently retried. `inputRecords` is the exact snapshot used by the tool. Store save failure is displayed as failed in memory and freezes new runs; repair/restart must not replay the model call automatically.

The API is for a trusted single-user workstation, not authentication for remote hosting. It has no CORS allowance, file/tool execution API, token-return endpoint, arbitrary static file reader, uploads or implicit analytics. Local processes and other OS users who can reach loopback are outside its isolation boundary.
