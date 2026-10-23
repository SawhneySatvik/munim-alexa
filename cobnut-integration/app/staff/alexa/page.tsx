// file: app/staff/alexa/page.tsx
// Alexa+ in the staff screens: the owner talks to Munim's agents through Alexa (components/staff/alexa-panel.tsx).
import type { Metadata } from "next";
import { AlexaPanel } from "@/components/staff/alexa-panel";

export const metadata: Metadata = { title: "Alexa+" };

export default function Page() {
  return (
    <main className="wrap staff-main space-y-4 pb-10">
      <div>
        <h1 className="section-title">Alexa+</h1>
        <p className="mt-3 text-muted">
          The Echo Show on the bakery wall is another way into Munim. Ask it anything out loud: it routes the question to
          the right agent, reads back an answer cited from your books, and takes your yes or no on what Munim proposed.
        </p>
      </div>
      <AlexaPanel />
    </main>
  );
}
