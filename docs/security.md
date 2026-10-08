# Security

Chat AX is one shared room where several people talk to the same agents. The core rule: **joining the room never gives you anyone else's authority.** The agents have no standing access of their own. Every tool call runs as the verified person who sent that turn, or it doesn't run.

This page describes what the code enforces today. Each guarantee names the test that proves it.

## Who can get in

- **Sign-in is mandatory.** Until `CF_ACCESS_ISS` and `CF_ACCESS_AUD` are set, every route, including the API, returns a setup notice with status 503. A fresh deploy is never open. (`src/setup-page.test.ts`, `src/access-verification.test.ts`)
- **Only your Access application gets in.** Chat AX accepts a request only with a token signed by your Access team's keys for the configured application. A token for any other application or team is refused, and so is a forged or unsigned one. (`src/access-verification.test.ts`)
- **The deployer creates both halves.** `npm run setup` creates the Access application and writes its issuer and audience as Worker secrets in one run, so there is no window in which someone else can attach their own application.
- **Local development only works on your own machine.** The development identity is used only on a loopback host with `ENVIRONMENT=dev` and no Access configuration. A misconfigured deploy still refuses, because its host is not loopback. (`src/auth.test.ts`)

## Whose tools the agent can use

- **Turns carry their author.** Each turn is bound to the verified identity of the person who sent it, at the moment it was sent. Overlapping turns from different people keep their own authority. Names, emails, or instructions typed into a message never change it. (`src/turn-authority.test.ts`)
- **Personal connectors stay personal.** Each person's MCP connection is stored in their own Durable Object, encrypted with a key derived for that person. The room can't read it. On your turns, the agent can list and call only your tools. (`src/capability-policy.test.ts`)
- **Using someone else's connector needs their approval, every time.** If the agent needs a tool that belongs to another participant, it can only stage a request. The owner approves or denies that exact call: same tool, same arguments, used once, within a time limit. (`src/mcp-approval.test.ts`)
- **Every tool call leaves a receipt.** Before any network call, Chat AX records who asked, whose connector is used, and which tool. Then it records the outcome. Receipts never store tokens or raw errors. (`src/mcp-receipts.test.ts`)

## How agents talk to each other

- **Strict mode by default.** An agent can talk to its own parent and children, and nothing else. (`src/agent-orchestration-policy.test.ts`)
- **Mesh mode needs explicit, narrow grants.** Sibling agents communicate only through a live grant that names the operation, the pair of agents, and an expiry. (`src/agent-communication.test.ts`)
- **Each agent's resources are private.** An agent's conversation, files, memory, skills, and jobs live in its own Durable Object. Copying an agent makes an independent snapshot. Deleting one removes its whole subtree, and resumes safely if it's interrupted. (`src/agent-deletion.test.ts`)

## External agents

Chat AX is itself an MCP server at `/mcp`. Clients that support OAuth sign in through your Access application and act as you. Short-lived agent capabilities are bound to a key the agent holds, the exact request, a scope, and a lifetime, and can be revoked. (`src/agent-capability.test.ts`)

## Secrets

- `MASTER_KEY` encrypts personal connector tokens. If you don't set it, Chat AX generates a random key on first use and stores it in the connector's Durable Object. That's safe, but the key can't be exported, so set your own `MASTER_KEY` if you might ever move the data. If you change `MASTER_KEY`, people just reconnect their connectors.
- `MCP_CAPABILITY_SECRET` signs agent capabilities. If you don't set it, Chat AX generates one and stores it in the room's Durable Object.
- No secret is ever sent to a model, written to the transcript, or stored in a receipt.

## What isn't covered

- **One room per deployment.** Everyone admitted by your Access application joins the same room and can see the whole conversation. Use separate deployments for groups that must not see each other.
- **Access decides who is on your team.** Chat AX trusts your Access policy completely. Keep it as narrow as you need.
- **Room members can change the shared settings,** including the system prompt and agent fleet. There are no admin-only room controls yet. `ADMIN_EMAILS` covers only diagnostic receipts.

Found a problem? Please open a private security advisory on the GitHub repository rather than a public issue.
