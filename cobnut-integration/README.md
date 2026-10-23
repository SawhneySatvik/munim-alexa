# Cobnut site integration (synced from food-ops, branch `alexa`)

These files are the Alexa+ layer as it runs **inside the Cobnut Bakehouse website** (Munim's storefront app, `apps/web`
in the private Munim repo, branch `alexa`). They're copied here so the submission repo holds everything built for the
hackathon. They're kept in sync by hand.

- Live: **https://munim-cobnut-alexa.vercel.app/alexa** (the full Cobnut site, with "Alexa+" in the top bar)
- MCP endpoint: **https://munim-cobnut-alexa.vercel.app/mcp** (Streamable HTTP, spec 2025-11-25)

| File (path inside `apps/web`) | What |
|---|---|
| `app/mcp/route.ts` | The MCP server as a Next.js route: SDK `Server` + `WebStandardStreamableHTTPServerTransport`, stateless, JSON responses, 8 tools |
| `lib/server/alexa-munim.ts` | Server-only Munim client. Owner lane through the site's demo sign-in; customer lane through the storefront key. Resolves citations, builds UUIDv7 commands |
| `app/(shop)/alexa/page.tsx` | The "Cobnut on Alexa+" page in the storefront layout |
| `components/alexa-device.tsx` | The simulated Echo Show: a browser MCP client of `/mcp`. It uses the same device script as `public/index.html` in this repo |

The standalone server in this repo (`api/mcp.js`, `lib/munim.js`, deployed at https://munim-alexa.vercel.app) has the
same tools, so the Alexa+ layer can run beside any Munim deployment as well as inside one.
