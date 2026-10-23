# Cobnut site integration (synced from food-ops, branch `alexa`)

These files are the Alexa+ layer as it runs **inside the Cobnut Bakehouse website** (Munim's storefront app, `apps/web`
in the private Munim repo, branch `alexa`). They're copied here so the submission repo holds everything built for the
hackathon. They're kept in sync by hand.

- Live: **https://munim-cobnut-alexa.vercel.app/staff/alexa** (sign in as the demo owner, then open **Alexa+** in the staff nav; the owner's home has the same panel)
- MCP endpoint: **https://munim-cobnut-alexa.vercel.app/mcp** (Streamable HTTP, spec 2025-11-25)

| File (path inside `apps/web`) | What |
|---|---|
| `app/mcp/route.ts` | The MCP server as a Next.js route: SDK `Server` + `WebStandardStreamableHTTPServerTransport`, stateless, JSON responses, 8 tools |
| `lib/server/alexa-munim.ts` | Server-only Munim client. Owner lane through the site's demo sign-in; customer lane through the storefront key. Resolves citations, builds UUIDv7 commands |
| `components/staff/alexa-panel.tsx` | Alexa+ for the owner: the voice layer over Munim's agents (Manager, Stock & purchasing, Customers, Money, Compliance, Menu & recipes). Each turn is an MCP call to `/mcp`; shows which agent answered, the citations, and approvals to take by voice |
| `app/staff/alexa/page.tsx` | The Alexa+ screen in the staff nav |
| `lib/server/demo-session.ts` | The demo sign-in, with a fallback to the main Cobnut site's demo sign-in |
| `app/(shop)/alexa/page.tsx` | The "Cobnut on Alexa+" page in the storefront layout |
| `components/alexa-device.tsx` | The simulated Echo Show: a browser MCP client of `/mcp`. It uses the same device script as `public/index.html` in this repo |

The standalone server in this repo (`api/mcp.js`, `lib/munim.js`, deployed at https://munim-alexa.vercel.app) has the
same tools, so the Alexa+ layer can run beside any Munim deployment as well as inside one.
