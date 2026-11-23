# MCP server (`/api/v1/mcp`)

Fase 3B: an [MCP](https://modelcontextprotocol.io) (Model Context
Protocol) server on top of the public API v1 — any MCP-aware client
(Claude Desktop/Code, Cursor, …) can read and write your CRM data
directly from a conversation.

> **Status:** read/write on contacts, deals, and tags; read-only on
> conversations/messages and pipelines/stages. No tool sends a
> message, launches a broadcast, deletes data, or touches billing —
> those stay out of MCP on purpose, for later with explicit human
> confirmation.

## Authentication

No new credential type. The MCP endpoint accepts the **same
`wacrm_live_…` API key** described in
[`docs/public-api.md`](./public-api.md), as a bearer token:

```
Authorization: Bearer wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Create one in **Settings → API keys** if you don't have one, with the
scopes the tools you want to use require (see the table below).
Requires the account's plan to have `hasAPI` (Business) — same gate as
the public REST API and the lead-capture webhook.

Rate limit: same per-key bucket every `/api/v1/*` REST call shares
(120 req/min — see `docs/public-api.md`).

## Connecting

Point your MCP client at:

```
https://your-crm.example.com/api/v1/mcp
```

Example generic client config:

```json
{
  "mcpServers": {
    "funilly": {
      "url": "https://your-crm.example.com/api/v1/mcp",
      "headers": { "Authorization": "Bearer wacrm_live_xxx" }
    }
  }
}
```

The server speaks the MCP **Streamable HTTP** transport, stateless
(no session cookie/ID to manage — every request is self-contained).

## Tools

Every tool enforces the same scope the equivalent REST endpoint does
— calling a tool without the right scope returns a tool-level error
(`isError: true`), not another account's data. The account a key
belongs to is always the account every tool operates on; it's never
something the client can pick.

| Tool                 | Scope                | Mirrors                                          |
| --------------------- | --------------------- | ------------------------------------------------- |
| `search_contacts`     | `contacts:read`      | `GET /api/v1/contacts`                            |
| `create_contact`      | `contacts:write`     | `POST /api/v1/contacts`                           |
| `update_contact`      | `contacts:write`     | `PATCH /api/v1/contacts/{id}`                     |
| `list_conversations`  | `conversations:read` | `GET /api/v1/conversations`                       |
| `list_messages`       | `messages:read`      | `GET /api/v1/conversations/{id}/messages`         |
| `create_deal`         | `deals:write`        | `POST /api/v1/deals`                              |
| `move_deal`           | `deals:write`        | `PATCH /api/v1/deals/{id}` (`pipelineId`/`stageId`) |
| `update_deal`         | `deals:write`        | `PATCH /api/v1/deals/{id}` (other fields)          |
| `list_tags`           | `tags:read`          | `GET /api/v1/tags`                                |
| `apply_tag`           | `tags:write`         | `POST /api/v1/contacts/{id}/tags`                 |
| `list_pipelines`      | `deals:read`         | reference data (no dedicated REST endpoint)        |

`move_deal` is split from `update_deal` because changing
`pipelineId`/`stageId` is the one operation that trips the deal's
won/lost DB triggers — same reasoning the dashboard's drag-and-drop
gets its own code path.

## Errors

Protocol-level failures (missing/invalid key, wrong plan, rate limit)
come back as JSON-RPC 2.0 errors, before any tool runs:

| HTTP status | `error.code` (JSON-RPC) | Meaning                              |
| ------------ | ------------------------ | ------------------------------------- |
| 401          | `-32001`                 | Missing/invalid/revoked/expired key   |
| 403          | `-32002`                 | Valid key, plan lacks `hasAPI`        |
| 429          | `-32003`                 | Per-key rate limit exceeded           |
| 404          | `-32004`                 | (reserved)                            |
| 400          | `-32602`                 | Invalid params                        |
| 500          | `-32603`                 | Internal error                        |

Tool-level failures (bad input, not found, missing scope) are a
normal `CallToolResult` with `isError: true` and a human-readable
message — the model sees the failure as part of the conversation
instead of the connection dying.

## Example (raw JSON-RPC over curl)

```bash
curl -X POST https://your-crm.example.com/api/v1/mcp \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": { "name": "search_contacts", "arguments": { "phone": "+5511999990000" } }
  }'
```

In practice you'll use an MCP client library/app rather than raw curl
— this is just to show the wire format.
