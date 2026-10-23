// file: app/mcp/route.ts
// Munim on Alexa+: a self-hosted MCP server, Streamable HTTP, spec 2025-11-25 (stateless, JSON responses), served by
// the Cobnut site itself at /mcp. Every tool calls the live Munim API (lib/server/alexa-munim.ts); answers carry a
// ready-to-speak `speech` sentence plus structured data for a screen device. Numbers are never computed here: they are
// Munim's cited values or "Cannot verify". The /alexa page is a browser MCP client of this endpoint.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  askMunim,
  decideDraft,
  itemAvailability,
  menu,
  pendingApprovals,
  pickupSlots,
  shopBrief,
} from "@/lib/server/alexa-munim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Args = Record<string, unknown>;
const str = (a: Args, k: string) => (typeof a[k] === "string" ? (a[k] as string) : undefined);
const outlet = { outlet: { type: "string", description: "Hazratganj or Gomti Nagar (default: the first outlet)" } };

type InputSchema = { type: "object"; properties: Record<string, object>; required?: string[] };
const TOOLS: Array<{ name: string; title: string; description: string; inputSchema: InputSchema; run: (a: Args) => Promise<unknown> }> = [
  {
    name: "shop_brief",
    title: "Shop brief",
    description: "Owner: a short spoken brief — open findings (money leaks, compliance, stock), how many are high, and how many proposals wait for approval.",
    inputSchema: { type: "object", properties: {} },
    run: () => shopBrief(),
  },
  {
    name: "ask_munim",
    title: "Ask Munim",
    description: "Owner: ask any question about the business. Munim's specialists answer only from the shop's records, every number cited, or abstain with 'Cannot verify'. Can take up to ~30 s.",
    inputSchema: { type: "object", properties: { question: { type: "string", minLength: 3, maxLength: 500 } }, required: ["question"] },
    run: (a) => askMunim(str(a, "question") ?? ""),
  },
  {
    name: "pending_approvals",
    title: "Pending approvals",
    description: "Owner: the proposals Munim drafted that wait for a person's decision (campaigns, purchase orders, recipe changes), numbered.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 10 } } },
    run: (a) => pendingApprovals(typeof a.limit === "number" ? a.limit : 5),
  },
  {
    name: "approve_draft",
    title: "Approve a proposal",
    description: "Owner: approve one drafted proposal by draft_id, as proposed. Recorded under the owner's name through Munim's approval command.",
    inputSchema: { type: "object", properties: { draft_id: { type: "string", format: "uuid" }, reason: { type: "string", maxLength: 500 } }, required: ["draft_id"] },
    run: (a) => decideDraft(str(a, "draft_id"), "approve", str(a, "reason")),
  },
  {
    name: "reject_draft",
    title: "Reject a proposal",
    description: "Owner: reject one drafted proposal by draft_id, with a short reason.",
    inputSchema: { type: "object", properties: { draft_id: { type: "string", format: "uuid" }, reason: { type: "string", maxLength: 500 } }, required: ["draft_id"] },
    run: (a) => decideDraft(str(a, "draft_id"), "reject", str(a, "reason")),
  },
  {
    name: "item_availability",
    title: "Is it available?",
    description: "Customer: is a menu item available today at an outlet, and its price — from the shop's live menu.",
    inputSchema: { type: "object", properties: { item: { type: "string", minLength: 2, maxLength: 80 }, ...outlet }, required: ["item"] },
    run: (a) => itemAvailability(str(a, "item") ?? "", str(a, "outlet")),
  },
  {
    name: "menu",
    title: "Menu",
    description: "Customer: today's menu at an outlet, with prices and availability.",
    inputSchema: { type: "object", properties: { ...outlet } },
    run: (a) => menu(str(a, "outlet")),
  },
  {
    name: "pickup_slots",
    title: "Pickup slots",
    description: "Customer: the next open pickup windows at an outlet.",
    inputSchema: { type: "object", properties: { ...outlet } },
    run: (a) => pickupSlots(str(a, "outlet")),
  },
];

function buildServer(): Server {
  const server = new Server(
    { name: "munim-alexa", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Munim runs a restaurant/bakery business (demo: Cobnut Bakehouse, Lucknow). Owner tools answer from the shop's own " +
        "records with citations, or say 'Cannot verify'. A person approves every change: approve_draft and reject_draft " +
        "record the owner's decision on a proposal Munim drafted. Speak the `speech` field.",
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) return { content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }], isError: true };
    try {
      const data = (await tool.run((req.params.arguments ?? {}) as Args)) as Record<string, unknown>;
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
    } catch (e) {
      return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  });
  return server;
}

export async function POST(req: Request): Promise<Response> {
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

const notAllowed = () =>
  Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: POST JSON-RPC to /mcp" }, id: null },
    { status: 405, headers: { Allow: "POST" } },
  );
export const GET = notAllowed;
export const DELETE = notAllowed;
