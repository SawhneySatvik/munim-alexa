// file: app/(shop)/alexa/page.tsx
// Cobnut on Alexa+: the storefront's page for the Alexa+ integration. The device below talks to this site's own MCP
// endpoint (/mcp, Streamable HTTP, spec 2025-11-25), which answers from Munim's live books.
import type { Metadata } from "next";
import { AlexaDevice } from "@/components/alexa-device";

export const metadata: Metadata = {
  title: "Cobnut on Alexa+",
  description: "Ask Cobnut Bakehouse's books out loud: cited answers, approvals by voice, and what's fresh today.",
};

export default function AlexaPage() {
  return (
    <main style={{ padding: "32px 16px 8px", maxWidth: 1100, margin: "0 auto" }}>
      <p style={{ fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase", opacity: 0.7, margin: 0 }}>Munim · Alexa+</p>
      <h1 style={{ fontSize: "clamp(28px, 4vw, 44px)", margin: "6px 0 10px", lineHeight: 1.1 }}>Cobnut on Alexa+</h1>
      <p style={{ maxWidth: 760, margin: "0 0 6px", lineHeight: 1.5 }}>
        Nandini runs Cobnut&apos;s two bakeries on Munim. On Alexa+ she asks her own books out loud. Every number in an answer
        is cited from Munim&apos;s records, or Munim says it cannot verify. She approves or rejects what Munim proposed by
        voice. Customers ask what&apos;s fresh today.
      </p>
      <p style={{ maxWidth: 760, margin: 0, fontSize: 14, opacity: 0.75 }}>
        This is a simulated Echo Show, and a real MCP client of this site&apos;s server at <code>/mcp</code> (Streamable HTTP,
        spec 2025-11-25). Cobnut Bakehouse and its data are synthetic.
      </p>
      <AlexaDevice />
    </main>
  );
}
