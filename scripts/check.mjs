// End-to-end check: initialize (asserts protocol 2025-11-25) -> tools/list -> tools/call shop_brief, over Streamable HTTP.
// Usage: node scripts/check.mjs https://<deployment>/mcp
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.argv[2] || "http://localhost:3000/mcp");
const transport = new StreamableHTTPClientTransport(url);
const client = new Client({ name: "munim-alexa-check", version: "0.1.0" });
await client.connect(transport);
const version = transport.protocolVersion;
console.log(`server: ${client.getServerVersion()?.name}  protocolVersion: ${version}`);
if (version !== "2025-11-25") throw new Error(`expected 2025-11-25, got ${version}`);
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
const brief = await client.callTool({ name: "shop_brief", arguments: {} });
if (brief.isError) throw new Error(brief.content?.[0]?.text);
console.log("shop_brief →", brief.structuredContent?.speech);
await client.close();
console.log("OK");
