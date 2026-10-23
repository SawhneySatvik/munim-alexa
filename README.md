# Munim on Alexa+

**Ask your restaurant's books out loud and get answers you can trust.** Munim is an operating system for small restaurant
groups, bakeries and cloud kitchens: till, kitchen, stock, purchasing and ledgers, with AI specialists that explain what
happened, find money leaking, and draft actions. **A person approves every change.**

This repo puts Munim behind **Alexa+** as a self-hosted **MCP server (Streamable HTTP, spec 2025-11-25)** plus an
**Agent Skill**, with a simulated Echo Show client. Alexa+ can already reorder a meal from a delivery app. What it can't
do is answer *"which ingredients are running low at Hazratganj?"* from your own stock records, with every number cited,
or say "Cannot verify" instead of guessing. It also can't take the owner's yes or no on a proposal. This repo adds those.

- **Live:** https://munim-alexa.vercel.app (Echo Show simulator) · MCP endpoint `https://munim-alexa.vercel.app/mcp`
- **Demo business:** Cobnut Bakehouse, a synthetic two-outlet bakery in Lucknow running on the live Munim deployment.
  All data is synthetic.

## Tools
| Tool | Who | What |
|---|---|---|
| `shop_brief` | owner | open findings (waste spikes, lapsing regulars, licences), how many are high, approvals waiting |
| `ask_munim` | owner | any question about the business. Munim's specialists answer only from the books: every number is a `⟨snapshot·row·field⟩` ref resolved by Munim core, returned as citations, or the answer abstains |
| `pending_approvals` | owner | the proposals Munim drafted (campaigns, purchase orders, recipe changes), numbered |
| `approve_draft` / `reject_draft` | owner | the owner's decision, recorded through Munim's guarded approval command (`drafts.approve.v1` / `drafts.reject.v1`). The MCP layer adds no write path of its own |
| `item_availability`, `menu`, `pickup_slots` | customer | from the live storefront (public storefront key) |

Every result carries a ready-to-speak `speech` sentence plus structured data for Echo Show cards.

## How it works
```
Echo Show sim (browser MCP client)  ─┐
Claude / any MCP client             ─┼─ JSON-RPC over Streamable HTTP ─▶  api/mcp.js (Vercel function, stateless)
                                     ┘                                        │  lib/munim.js
                                                                              ├─ owner lane: Cobnut demo sign-in → Bearer + X-Munim-Tenant
                                                                              └─ customer lane: X-Munim-Storefront-Key
                                                                                   ▼
                                                              Munim core API (munim-api.vercel.app) → Postgres, AI specialists
```
- `api/mcp.js`: `McpServer` + `StreamableHTTPServerTransport` (TS SDK 1.32.1, `LATEST_PROTOCOL_VERSION` 2025-11-25),
  stateless with JSON responses, one server per request.
- `lib/munim.js`: the API client, citation resolver (`_minor` → ₹, `_milli` → units, `_bp` → %) and UUIDv7 command ids.
- `public/index.html`: the simulated Echo Show. It's a real MCP client: initialize → tools/list → tools/call. It takes
  Web Speech voice in/out, renders cards and shows the wire log. Owner and customer modes.
- `skills/munim-owner/SKILL.md`: the Agent Skill (intent → tool, citation and approval rules).

## Run
```bash
npm install
MUNIM_STOREFRONT_KEY=… node scripts/local.mjs            # http://localhost:3000 (page) + /mcp
node scripts/check.mjs https://munim-alexa.vercel.app/mcp   # asserts protocolVersion 2025-11-25, lists tools, calls shop_brief
claude mcp add --transport http munim https://munim-alexa.vercel.app/mcp   # or MCP Inspector
```
Env: `MUNIM_STOREFRONT_KEY` (required for customer tools), `MUNIM_API_ORIGIN`, `MUNIM_WEB_ORIGIN` (defaults: the live
Munim deployment).

## Built during the hackathon
Munim itself (core API, AI specialists, storefront, Cobnut demo) existed before the hackathon. This repo (the MCP
server, the citation resolver, the voice-first tool design, the Echo Show client and the Agent Skill) was built on
23 Oct 2026.

MIT licence.
