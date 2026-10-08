# Person-to-person requests

Chat AX lets an authenticated agent ask another person for work without sharing either person's credentials.

## Example

Sam's agent calls `request_person` with Jordan's verified email, a short title, and details. Chat AX stores the request, returns its durable ID, and sends Jordan a targeted notification. Jordan can accept, decline, reply, or mark the request complete. Sam can cancel work that is still pending or accepted.

The sender comes from the verified Access identity. Names, email addresses, and owner fields inside prompt text never choose the sender. Recipient actions require a verified identity whose email exactly matches the stored recipient email. Completing a request does not grant Chat AX access to Jordan's connectors; any later tool call on their accounts still requires Jordan's own connected grant.

## MCP behavior

The endpoint is `https://<your-chat-host>/mcp`.

It exposes five tools:

- `request_person`
- `list_my_requests`
- `get_request`
- `respond_to_request`
- `cancel_request`

Clients that send the `io.modelcontextprotocol/tasks` capability receive a durable task from `request_person`. They can reconnect and use `tasks/get`, provide a recipient decision through `tasks/update`, or cancel as the requester through `tasks/cancel`. Clients without that capability receive an ordinary tool result containing the same request ID.

Chat AX supports the 2026-07-28 stateless request shape and the 2025-11-25 initialization flow. Durable Object state, rather than an MCP connection, owns request continuity.

## Visibility and notifications

Only the requester and intended recipient receive the request in room snapshots and MCP reads. Durable notifications are filtered the same way. Web Push is best effort and targets subscriptions whose verified owner email matches the notification recipient.

## Connecting another MCP client

Chat AX publishes OAuth metadata at `/.well-known/oauth-protected-resource/mcp` that points at your Access team, so MCP clients that support OAuth can sign in to `/mcp` as you. MCP portals that proxy Chat AX need their OAuth callback URL allowed by your Access application.
