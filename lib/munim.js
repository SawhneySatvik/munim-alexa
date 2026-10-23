// Client for the live Munim API (https://munim-api.vercel.app). Two lanes, exactly as Munim's own apps use them:
//   - owner:    a demo owner session from the Cobnut demo sign-in (POST /staff/demo-session), then Bearer + X-Munim-Tenant
//   - customer: the Cobnut storefront key (X-Munim-Storefront-Key; public by design, never logged or put in a URL)
// The MCP layer adds no write path of its own: approve/reject go through Munim's guarded approval commands.
import { randomBytes } from "node:crypto";

const API = process.env.MUNIM_API_ORIGIN || "https://munim-api.vercel.app";
const WEB = process.env.MUNIM_WEB_ORIGIN || "https://munim-cobnut.vercel.app";
const STOREFRONT_KEY = process.env.MUNIM_STOREFRONT_KEY || "";

let ownerSession = null; // { token, tenant_id, at } — cached per warm instance

async function owner() {
  if (ownerSession && Date.now() - ownerSession.at < 30 * 60 * 1000) return ownerSession;
  const res = await fetch(`${WEB}/staff/demo-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ person: "owner" }),
  });
  if (!res.ok) throw new Error(`owner sign-in failed (${res.status})`);
  const body = await res.json();
  ownerSession = { token: body.token, tenant_id: body.tenant_id, at: Date.now() };
  return ownerSession;
}

async function ownerCall(path, init = {}) {
  const s = await owner();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${s.token}`,
      "X-Munim-Tenant": s.tenant_id,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) ownerSession = null;
    throw new Error(body?.error?.message || `Munim API ${res.status}`);
  }
  return body;
}

async function storefrontCall(path) {
  const res = await fetch(`${API}${path}`, { headers: { "X-Munim-Storefront-Key": STOREFRONT_KEY } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `Munim storefront ${res.status}`);
  return body;
}

/** UUIDv7 (Munim command ids must be v7). */
export function uuidv7() {
  const b = randomBytes(16);
  const ts = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---- citations: Munim answers carry ⟨snap:<id>·<row>·<field>⟩ refs that core resolves to values ----
const inr = (paise) =>
  "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: paise % 100 ? 2 : 0 });

function formatRef(ref, value) {
  const field = ref.replace(/[⟨⟩]/g, "").split("·").pop() || "";
  if (typeof value !== "number") return String(value);
  if (/_minor$|_paise$/.test(field)) return inr(value);
  if (/_milli$/.test(field)) return (value / 1000).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (/_bp$/.test(field)) return `${(value / 100).toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
  return value.toLocaleString("en-IN");
}

/** Replace every ref in Munim text with its resolved value; an unresolved ref is shown as [unverified]. */
export function resolveText(text, resolved = []) {
  const map = new Map(resolved.map((r) => [r.ref, r.value]));
  return text.replace(/⟨[^⟩]+⟩/g, (ref) => (map.has(ref) ? formatRef(ref, map.get(ref)) : "[unverified]"));
}

function citationsOf(resolved = []) {
  return resolved.map((r) => {
    const parts = r.ref.replace(/[⟨⟩]/g, "").split("·");
    const field = (parts[2] || "").replace(/_(milli|minor|paise|bp)$/, "").replace(/_/g, " ") || null;
    return { source: parts[0], field, value: formatRef(r.ref, r.value) };
  });
}

const human = (s) => s.replace(/\.v\d+$/, "").replace(/[._]/g, " ");

function draftSummary(d) {
  const p = d.payload || {};
  const label = p.name || p.title || p.supplier_name || p.item_name || p.ingredient_name || null;
  return label ? `${human(d.command_type)}: ${label}` : human(d.command_type);
}

// ---------------------------------------------------------------- owner tools

export async function askMunim(question) {
  const body = await ownerCall("/v1/ask", { method: "POST", body: JSON.stringify({ question }) });
  const a = body.answer || body; // { thread_id, turn, answer: { envelope, resolved_refs, signature } }
  const env = a.envelope || {};
  const resolved = a.resolved_refs || [];
  const segments = env.segments || [];
  const abstained = Boolean(env.abstained);
  const answer = abstained
    ? `Cannot verify that from the shop's records${env.reason_code ? ` (${human(env.reason_code)})` : ""}.`
    : segments.map((s) => resolveText(s.text, resolved)).join(" ");
  return {
    question,
    answer,
    abstained,
    specialist: a.signature?.specialist || null,
    thread_id: body.thread_id || null,
    citations: citationsOf(resolved),
    speech: answer,
  };
}

export async function inbox() {
  const body = await ownerCall("/v1/inbox");
  const items = body.items || [];
  const findings = items
    .filter((i) => i.kind === "finding" && i.finding.status === "open")
    .map((i) => ({
      finding_id: i.finding.finding_id,
      severity: i.finding.severity,
      type: human(i.finding.type),
      text: (i.finding.envelope?.segments || []).map((s) => resolveText(s.text, i.finding.resolved_refs)).join(" "),
      impact:
        i.finding.envelope?.impact_ref && !/null|unverified/.test(resolveText(i.finding.envelope.impact_ref, i.finding.resolved_refs))
          ? resolveText(i.finding.envelope.impact_ref, i.finding.resolved_refs)
          : null,
    }));
  const drafts = items
    .filter((i) => i.kind === "draft")
    .map((i) => ({
      draft_id: i.draft.draft_id,
      command_type: i.draft.command_type,
      summary: draftSummary(i.draft),
      source: i.draft.source || null,
      status: i.draft.status || "proposed",
    }))
    .filter((d) => d.status === "proposed");
  return { findings, drafts };
}

const SEV = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export async function shopBrief() {
  const { findings, drafts } = await inbox();
  const top = [...findings].sort((a, b) => (SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9)).slice(0, 3);
  const high = findings.filter((f) => f.severity === "high" || f.severity === "critical").length;
  let speech = `You have ${findings.length} open findings, ${high} of them high, and ${drafts.length} proposals waiting for your approval.`;
  if (top[0]) speech += ` The most urgent: ${top[0].type}${top[0].impact ? `, about ${top[0].impact}` : ""}.`;
  return { open_findings: findings.length, high_findings: high, pending_approvals: drafts.length, top_findings: top, speech };
}

export async function pendingApprovals(limit = 5) {
  const { drafts } = await inbox();
  const list = drafts.slice(0, limit).map((d, i) => ({ number: i + 1, ...d }));
  const speech = list.length
    ? `${drafts.length} proposals are waiting. ` + list.slice(0, 3).map((d) => `Number ${d.number}: ${d.summary}.`).join(" ")
    : "Nothing is waiting for your approval.";
  return { total: drafts.length, approvals: list, speech };
}

export async function decideDraft(draftId, decision, reason) {
  const draft = await ownerCall(`/v1/drafts/${draftId}`);
  const d = draft.draft || draft;
  const payload =
    decision === "approve"
      ? { draft_id: draftId, command_type: d.command_type, edited_payload: null, reason: reason || null }
      : { draft_id: draftId, reason: reason || "Rejected by the owner by voice", reason_code: "other" };
  const type = decision === "approve" ? "drafts.approve.v1" : "drafts.reject.v1";
  const command_id = uuidv7();
  const result = await ownerCall(`/v1/drafts/${draftId}:${decision}`, {
    method: "POST",
    body: JSON.stringify({ command_id, idempotency_key: `alexa:${command_id}`, type, payload }),
  });
  const summary = draftSummary(d);
  return {
    draft_id: draftId,
    decision,
    summary,
    committed_at: result.committed_at || null,
    speech: decision === "approve" ? `Approved: ${summary}. It's recorded under your name.` : `Rejected: ${summary}.`,
  };
}

// ------------------------------------------------------------- customer tools

async function outletByName(name) {
  const { outlets } = await storefrontCall("/v1/storefront/outlets");
  if (!name) return outlets[0];
  const n = name.toLowerCase();
  return outlets.find((o) => o.name.toLowerCase().includes(n)) || outlets[0];
}

export async function menu(outletName) {
  const outlet = await outletByName(outletName);
  const body = await storefrontCall(`/v1/storefront/outlets/${outlet.outlet_id}/menu`);
  const raw = body.items || body.menu?.items || body.categories?.flatMap((c) => c.items || []) || [];
  const items = raw.slice(0, 40).map((i) => ({
    name: i.name || i.display_name,
    price: typeof (i.price_minor ?? i.price_paise) === "number" ? inr(i.price_minor ?? i.price_paise) : null,
    available: i.available ?? i.is_available ?? !i.sold_out,
  }));
  const avail = items.filter((i) => i.available !== false);
  return {
    outlet: outlet.name,
    items,
    speech: `${outlet.name} has ${avail.length} items available today, including ${avail.slice(0, 3).map((i) => i.name).join(", ")}.`,
  };
}

export async function itemAvailability(item, outletName) {
  const m = await menu(outletName);
  const q = item.toLowerCase();
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  const hit =
    m.items.find((i) => i.name.toLowerCase().includes(q)) ||
    m.items.find((i) => words.every((w) => i.name.toLowerCase().includes(w))) ||
    m.items.find((i) => words.some((w) => i.name.toLowerCase().includes(w)));
  if (!hit) {
    return { outlet: m.outlet, item, found: false, speech: `${m.outlet} doesn't have ${item} on today's menu.` };
  }
  const yes = hit.available !== false;
  return {
    outlet: m.outlet,
    item: hit.name,
    found: true,
    available: yes,
    price: hit.price,
    speech: yes
      ? `Yes, ${hit.name} is available at ${m.outlet}${hit.price ? ` for ${hit.price}` : ""}.`
      : `${hit.name} is sold out at ${m.outlet} right now.`,
  };
}

export async function pickupSlots(outletName) {
  const outlet = await outletByName(outletName);
  const body = await storefrontCall(`/v1/storefront/outlets/${outlet.outlet_id}/pickup-windows`);
  const raw = body.windows || body.pickup_windows || body.items || [];
  const fmt = (t) =>
    new Date(t).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: outlet.tz || "Asia/Kolkata" });
  const slots = raw.slice(0, 8).map((w) => ({
    from: w.starts_at || w.from || w.start,
    to: w.ends_at || w.to || w.end,
    label: `${fmt(w.starts_at || w.from || w.start)}–${fmt(w.ends_at || w.to || w.end)}`,
    available: w.available ?? (w.remaining_capacity ?? 1) > 0,
  }));
  const open = slots.filter((s) => s.available !== false);
  return {
    outlet: outlet.name,
    slots,
    speech: open.length ? `The next pickup slots at ${outlet.name} are ${open.slice(0, 3).map((s) => s.label).join(", ")}.` : `No pickup slots are open at ${outlet.name} right now.`,
  };
}
