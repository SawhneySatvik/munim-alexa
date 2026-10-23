// @ts-nocheck
// file: components/staff/alexa-panel.tsx
// Alexa+ for the owner: the voice layer over Munim's agents. Every turn is a real MCP call (JSON-RPC over Streamable
// HTTP, spec 2025-11-25) to this site's /mcp server, the same server an Alexa+ device talks to. The panel shows which of
// Munim's agents answered, the citations behind every number, and the proposals that wait for the owner's yes or no.
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const PROTOCOL = "2025-11-25";

const AGENTS = [
  { id: "manager", name: "Manager", does: "Runs the day, answers across the business", mark: "M" },
  { id: "inventory_purchasing", name: "Stock & purchasing", does: "Stock, waste, reorders, suppliers", mark: "S" },
  { id: "customers", name: "Customers", does: "Regulars, lapsing guests, campaigns", mark: "C" },
  { id: "finance", name: "Money", does: "Settlements, leaks, the books", mark: "₹" },
  { id: "compliance", name: "Compliance", does: "Licences, checklists, temperatures", mark: "L" },
  { id: "catalogue", name: "Menu & recipes", does: "Recipes, costs, prices", mark: "R" },
];

const PROMPTS = [
  "Alexa, how's Cobnut doing today?",
  "Alexa, ask Munim which ingredients are running low at Hazratganj",
  "Alexa, ask Munim why waste spiked last week",
  "Alexa, what's waiting for my approval?",
];

function agentOf(tool, data) {
  if (tool === "ask_munim") return data?.specialist || "manager";
  if (tool === "shop_brief") {
    const t = data?.top_findings?.[0]?.type || "";
    return /inventory|waste|stock/.test(t) ? "inventory_purchasing" : /customer|regular/.test(t) ? "customers" : /compliance|licen/.test(t) ? "compliance" : "manager";
  }
  if (tool === "pending_approvals" || tool === "approve_draft" || tool === "reject_draft") {
    const s = data?.approvals?.[0]?.source || data?.summary || "";
    return /customers/.test(s) ? "customers" : /catalogue|recipe/.test(s) ? "catalogue" : /inventory|purchase/.test(s) ? "inventory_purchasing" : "manager";
  }
  return "manager";
}

function route(text, approvals) {
  const t = text.toLowerCase().replace(/^alexa,?\s*/, "").replace(/^ask munim\s*/, "");
  const num = () => {
    const d = t.match(/\b(\d+)\b/);
    if (d) return +d[1];
    const w = { one: 1, first: 1, two: 2, second: 2, three: 3, third: 3 };
    const k = t.split(/\W+/).find((x) => w[x]);
    return k ? w[k] : 1;
  };
  if (/^(yes,?\s*)?approve/.test(t)) { const d = approvals[num() - 1]; return d ? ["approve_draft", { draft_id: d.draft_id }] : null; }
  if (/^reject/.test(t)) { const d = approvals[num() - 1]; return d ? ["reject_draft", { draft_id: d.draft_id, reason: "Not now, said the owner on Alexa" }] : null; }
  if (/approv|waiting for me|pending|proposals/.test(t)) return ["pending_approvals", { limit: 5 }];
  if (/how('s| is) (the )?(cobnut|business|shop|bakery)|doing today|brief|anything i should know/.test(t)) return ["shop_brief", {}];
  return ["ask_munim", { question: text.replace(/^alexa,?\s*/i, "").replace(/^ask munim\s*/i, "") }];
}

export function AlexaPanel({ compact = false }) {
  const [status, setStatus] = useState("connecting");
  const [turns, setTurns] = useState([]);
  const [busy, setBusy] = useState(null);
  const [active, setActive] = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [draft, setDraft] = useState("");
  const rpcId = useRef(0);
  const negotiated = useRef(null);

  async function rpc(method, params, notify = false) {
    const msg = { jsonrpc: "2.0", method, ...(params ? { params } : {}), ...(notify ? {} : { id: ++rpcId.current }) };
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    if (negotiated.current) headers["MCP-Protocol-Version"] = negotiated.current;
    const res = await fetch("/mcp", { method: "POST", headers, body: JSON.stringify(msg) });
    if (notify) return null;
    const body = await res.json();
    if (body.error) throw new Error(body.error.message);
    return body.result;
  }

  useEffect(() => {
    (async () => {
      try {
        const init = await rpc("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "cobnut-alexa-owner", version: "0.1.0" } });
        negotiated.current = init.protocolVersion;
        await rpc("notifications/initialized", undefined, true);
        const tools = await rpc("tools/list", {});
        setStatus(`Connected · MCP ${init.protocolVersion} · ${tools.tools.length} skills`);
      } catch (e) {
        setStatus("offline");
      }
    })();
  }, []);

  function speak(text) {
    try {
      if (!text || !("speechSynthesis" in window)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/₹\s?/g, "rupees "));
      u.lang = "en-IN";
      speechSynthesis.speak(u);
    } catch {}
  }

  async function say(text) {
    if (!text.trim() || busy) return;
    const r = route(text, approvals);
    if (!r) {
      const reply = "Ask me what's waiting for your approval first.";
      setTurns((ts) => [...ts, { you: text, reply, agent: "manager" }]);
      speak(reply);
      return;
    }
    const [tool, args] = r;
    const guess = tool === "ask_munim" ? "manager" : agentOf(tool, {});
    setActive(guess);
    setBusy({ text, tool, t0: Date.now() });
    try {
      const res = await rpc("tools/call", { name: tool, arguments: args });
      const data = res.structuredContent || {};
      const reply = res.isError ? (res.content?.[0]?.text || "Munim couldn't answer that.") : data.speech;
      const agent = agentOf(tool, data);
      if (tool === "pending_approvals" && !res.isError) setApprovals(data.approvals || []);
      if ((tool === "approve_draft" || tool === "reject_draft") && !res.isError) setApprovals((a) => a.filter((d) => d.draft_id !== args.draft_id));
      setActive(agent);
      setTurns((ts) => [...ts, { you: text, reply, agent, tool, data: res.isError ? null : data, error: res.isError }]);
      speak(reply);
    } catch (e) {
      setTurns((ts) => [...ts, { you: text, reply: "I couldn't reach Munim just now.", agent: "manager", error: true }]);
    } finally {
      setBusy(null);
    }
  }

  const [, tick] = useState(0);
  useEffect(() => { if (!busy) return; const i = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(i); }, [busy]);

  const agentName = (id) => AGENTS.find((a) => a.id === id)?.name || "Manager";

  return (
    <section aria-label="Alexa+" className="alexa-owner card">
      <style>{CSS}</style>
      <header className="ao-head">
        <div className="ao-ring" data-busy={busy ? "1" : "0"} aria-hidden="true" />
        <div>
          <p className="stat-label">Alexa+ · Echo Show in the bakery</p>
          <h2 className="ao-title">Talk to all of Munim&apos;s agents, hands free</h2>
          <p className="text-[14px] text-muted">{status === "offline" ? "Alexa can't reach Munim right now." : status}</p>
        </div>
      </header>

      <ul className="ao-agents" aria-label="Munim's agents">
        {AGENTS.map((a) => (
          <li key={a.id} data-on={active === a.id ? "1" : "0"}>
            <span className="ao-mark" aria-hidden="true">{a.mark}</span>
            <span><b>{a.name}</b>{!compact && <small>{a.does}</small>}</span>
          </li>
        ))}
      </ul>

      <ol className="ao-turns" aria-live="polite">
        {turns.slice(compact ? -1 : -6).map((t, i) => (
          <li key={i}>
            <p className="ao-you">“{t.you}”</p>
            <div className="ao-reply" data-error={t.error ? "1" : "0"}>
              <span className="ao-by">Alexa · via {agentName(t.agent)}</span>
              <p>{t.reply}</p>
              {t.tool === "ask_munim" && t.data?.citations?.length > 0 && (
                <ul className="ao-cites" aria-label="Cited from the books">
                  {t.data.citations.map((c, j) => <li key={j}><span>{c.field}</span><b>{c.value}</b></li>)}
                </ul>
              )}
              {t.tool === "ask_munim" && t.data?.abstained && <p className="ao-note">Munim abstained rather than guess.</p>}
              {t.tool === "shop_brief" && t.data && (
                <div className="ao-stats">
                  <span><b>{t.data.open_findings}</b> open findings</span>
                  <span><b>{t.data.high_findings}</b> high</span>
                  <span><b>{t.data.pending_approvals}</b> waiting for you</span>
                </div>
              )}
              {t.tool === "pending_approvals" && t.data?.approvals?.length > 0 && (
                <ol className="ao-approvals">
                  {t.data.approvals.slice(0, 4).map((d) => (
                    <li key={d.draft_id}>
                      <span>#{d.number} {d.summary}</span>
                      <span className="ao-actions">
                        <button type="button" className="chip" disabled={!!busy || !approvals.some((x) => x.draft_id === d.draft_id)} onClick={() => say(`Alexa, reject number ${d.number}`)}>Reject</button>
                        <button type="button" className="chip" disabled={!!busy || !approvals.some((x) => x.draft_id === d.draft_id)} onClick={() => say(`Alexa, approve number ${d.number}`)}>Approve</button>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {(t.tool === "approve_draft" || t.tool === "reject_draft") && t.data && (
                <p className="ao-note">Recorded under your name. <Link href="/staff/inbox">See it in the inbox</Link></p>
              )}
            </div>
          </li>
        ))}
        {busy && (
          <li>
            <p className="ao-you">“{busy.text}”</p>
            <div className="ao-reply ao-thinking">
              <span className="ao-by">Alexa · asking {agentName(active)}</span>
              <p>{busy.tool === "ask_munim" ? "Checking your books" : "One moment"}… {Math.round((Date.now() - busy.t0) / 1000)}s</p>
            </div>
          </li>
        )}
      </ol>

      <div className="ao-prompts" role="group" aria-label="Try saying">
        {PROMPTS.map((p) => <button key={p} type="button" className="chip" disabled={!!busy} onClick={() => say(p)}>{p}</button>)}
      </div>
      <form className="ao-say" onSubmit={(e) => { e.preventDefault(); const v = draft; setDraft(""); say(v); }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Say something to Alexa…" aria-label="Say something to Alexa" />
        <button type="submit" className="btn btn-primary" disabled={!!busy}>Say it</button>
      </form>
    </section>
  );
}

const CSS = `
.alexa-owner { display: grid; gap: 16px; }
.alexa-owner .ao-head { display: flex; gap: 14px; align-items: center; }
.alexa-owner .ao-title { font-size: clamp(20px, 2.4vw, 26px); font-weight: 700; margin: 2px 0; line-height: 1.2; }
.alexa-owner .ao-ring { width: 44px; height: 44px; flex: none; border-radius: 50%; border: 4px solid #1a9bd7; box-shadow: 0 0 0 0 #1a9bd755; }
.alexa-owner .ao-ring[data-busy="1"] { animation: ao-pulse 1.2s ease-out infinite; border-color: #00caff; }
@keyframes ao-pulse { 0% { box-shadow: 0 0 0 0 #00caff88; } 100% { box-shadow: 0 0 0 14px #00caff00; } }
.alexa-owner .ao-agents { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; list-style: none; padding: 0; margin: 0; }
.alexa-owner .ao-agents li { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 12px; border: 1px solid color-mix(in srgb, currentColor 14%, transparent); transition: background .2s, border-color .2s; }
.alexa-owner .ao-agents li[data-on="1"] { border-color: #1a9bd7; background: color-mix(in srgb, #1a9bd7 12%, transparent); }
.alexa-owner .ao-agents small { display: block; font-size: 12px; opacity: .7; }
.alexa-owner .ao-mark { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; background: color-mix(in srgb, currentColor 10%, transparent); flex: none; }
.alexa-owner .ao-agents li[data-on="1"] .ao-mark { background: #1a9bd7; color: #fff; }
.alexa-owner .ao-turns { list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; }
.alexa-owner .ao-you { margin: 0 0 6px; font-style: italic; opacity: .75; }
.alexa-owner .ao-reply { border-left: 3px solid #1a9bd7; padding: 4px 0 4px 12px; }
.alexa-owner .ao-reply[data-error="1"] { border-left-color: #b3261e; }
.alexa-owner .ao-reply p { margin: 2px 0; font-size: 17px; line-height: 1.45; }
.alexa-owner .ao-by { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; opacity: .7; }
.alexa-owner .ao-thinking p { opacity: .7; }
.alexa-owner .ao-cites { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; padding: 0; margin: 8px 0 0; }
.alexa-owner .ao-cites li { display: flex; gap: 8px; align-items: baseline; border: 1px dashed color-mix(in srgb, currentColor 25%, transparent); border-radius: 8px; padding: 4px 8px; font-size: 14px; }
.alexa-owner .ao-stats { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 6px; font-size: 15px; }
.alexa-owner .ao-stats b { font-size: 22px; }
.alexa-owner .ao-approvals { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 6px; }
.alexa-owner .ao-approvals li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px dashed color-mix(in srgb, currentColor 15%, transparent); }
.alexa-owner .ao-actions { display: flex; gap: 6px; }
.alexa-owner .ao-note { font-size: 14px !important; opacity: .8; }
.alexa-owner .ao-prompts { display: flex; flex-wrap: wrap; gap: 8px; }
.alexa-owner .ao-say { display: flex; gap: 8px; }
.alexa-owner .ao-say input { flex: 1; min-width: 0; min-height: 48px; padding: 0 14px; border-radius: 999px; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); background: transparent; font: inherit; color: inherit; }
`;
