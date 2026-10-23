// Munim on Alexa+: a self-hosted MCP server, Streamable HTTP, spec 2025-11-25 (stateless, JSON responses).
// Every tool calls the live Munim API; answers carry a ready-to-speak `speech` sentence plus structured data for a
// screen device (Echo Show cards). Numbers are never computed here: they are Munim's cited values or "Cannot verify".
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  askMunim, decideDraft, itemAvailability, menu, pendingApprovals, pickupSlots, shopBrief,
} from "../lib/munim.js";

const result = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
  structuredContent: data,
});
const failure = (e) => ({ content: [{ type: "text", text: e.message || String(e) }], isError: true });
const wrap = (fn) => async (args) => {
  try {
    return result(await fn(args));
  } catch (e) {
    return failure(e);
  }
};

function buildServer() {
  const server = new McpServer(
    { name: "munim-alexa", version: "0.1.0" },
    {
      instructions:
        "Munim runs a restaurant/bakery business (demo: Cobnut Bakehouse, Lucknow). Owner tools answer from the shop's " +
        "own records with citations, or say 'Cannot verify'. A person approves every change: approve_draft and " +
        "reject_draft record the owner's decision on a proposal Munim drafted. Speak the `speech` field.",
    },
  );

  server.registerTool(
    "shop_brief",
    {
      title: "Shop brief",
      description: "Owner: a short spoken brief — open findings (money leaks, compliance, stock), how many are high, and how many proposals wait for approval.",
      inputSchema: {},
    },
    wrap(() => shopBrief()),
  );
  server.registerTool(
    "ask_munim",
    {
      title: "Ask Munim",
      description: "Owner: ask any question about the business (stock, waste, sales, suppliers, customers). Munim's specialists answer only from the shop's records, every number cited, or abstain with 'Cannot verify'. Can take up to ~30 s.",
      inputSchema: { question: z.string().min(3).max(500) },
    },
    wrap(({ question }) => askMunim(question)),
  );
  server.registerTool(
    "pending_approvals",
    {
      title: "Pending approvals",
      description: "Owner: the proposals Munim drafted that wait for a person's decision (campaigns, purchase orders, recipe changes), numbered.",
      inputSchema: { limit: z.number().int().min(1).max(10).optional() },
    },
    wrap(({ limit }) => pendingApprovals(limit ?? 5)),
  );
  server.registerTool(
    "approve_draft",
    {
      title: "Approve a proposal",
      description: "Owner: approve one drafted proposal by draft_id, as proposed. Recorded under the owner's name through Munim's approval command.",
      inputSchema: { draft_id: z.string().uuid(), reason: z.string().max(500).optional() },
    },
    wrap(({ draft_id, reason }) => decideDraft(draft_id, "approve", reason)),
  );
  server.registerTool(
    "reject_draft",
    {
      title: "Reject a proposal",
      description: "Owner: reject one drafted proposal by draft_id, with a short reason.",
      inputSchema: { draft_id: z.string().uuid(), reason: z.string().min(1).max(500).optional() },
    },
    wrap(({ draft_id, reason }) => decideDraft(draft_id, "reject", reason)),
  );
  server.registerTool(
    "item_availability",
    {
      title: "Is it available?",
      description: "Customer: is a menu item available today at an outlet (Hazratganj or Gomti Nagar), and its price — from the shop's live menu.",
      inputSchema: { item: z.string().min(2).max(80), outlet: z.string().max(80).optional() },
    },
    wrap(({ item, outlet }) => itemAvailability(item, outlet)),
  );
  server.registerTool(
    "menu",
    {
      title: "Menu",
      description: "Customer: today's menu at an outlet, with prices and availability.",
      inputSchema: { outlet: z.string().max(80).optional() },
    },
    wrap(({ outlet }) => menu(outlet)),
  );
  server.registerTool(
    "pickup_slots",
    {
      title: "Pickup slots",
      description: "Customer: the next open pickup windows at an outlet.",
      inputSchema: { outlet: z.string().max(80).optional() },
    },
    wrap(({ outlet }) => pickupSlots(outlet)),
  );
  return server;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: POST JSON-RPC to /mcp" }, id: null });
    return;
  }
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

export const config = { maxDuration: 60 };
