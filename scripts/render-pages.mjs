/**
 * The pages that are pure functions, rendered with no server.
 *
 * The landing site, the sign-in confirmation and the public receipts page
 * take plain data and return a document — no database, no request, no
 * bindings. So their copy can be checked on any machine, and until now it
 * was only checked on one with a dev server running. Two red CI runs came
 * of that.
 *
 * Prints a JSON array of { label, html }. scripts/check-fidelity.cjs's
 * `copy` rule reads it; nothing else should.
 */
import { renderLanding, renderConfirm } from "../src/ui/pages/landing.ts";
import { receiptsHtml, receiptsPage } from "../src/receipts.ts";

const out = [
  {
    label: "renderLanding",
    html: renderLanding({ google: false, error: null, sentTo: null, devLink: null }),
  },
  {
    /* With Google configured and a link just sent — the two branches that
       add copy of their own. */
    label: "renderLanding (sent, google)",
    html: renderLanding({
      google: true,
      error: null,
      sentTo: "someone@example.com",
      devLink: null,
    }),
  },
  { label: "renderConfirm", html: renderConfirm("a-token") },
  {
    label: "receiptsPage",
    html: receiptsHtml(
      receiptsPage({
        title: "A cut",
        claim: null,
        external: [],
        pictures: [],
      }),
    ),
  },
];

console.log(JSON.stringify(out));
