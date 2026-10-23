// Local dev server mimicking Vercel's Node runtime (parsed JSON body) for /mcp, plus public/ for the Echo Show page.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import handler from "../api/mcp.js";

createServer(async (req, res) => {
  if (req.url.startsWith("/mcp")) {
    let raw = "";
    for await (const c of req) raw += c;
    req.body = raw ? JSON.parse(raw) : undefined;
    res.status = (s) => ((res.statusCode = s), res);
    res.json = (o) => res.setHeader("Content-Type", "application/json").end(JSON.stringify(o));
    return handler(req, res);
  }
  const html = await readFile(new URL("../public/index.html", import.meta.url)).catch(() => "no page yet");
  res.setHeader("Content-Type", "text/html; charset=utf-8").end(html);
}).listen(Number(process.env.PORT || 3000), () => console.log("http://localhost:" + (process.env.PORT || 3000)));
