/**
 * The refusals, as data, for the gate.
 *
 * src/refusals.ts is TypeScript and scripts/check-fidelity.cjs is CommonJS,
 * so the rule cannot import it. Rather than re-parse the source with a regex —
 * which would read a commented-out refusal as a real one, the exact mistake
 * the rule exists to prevent — this prints the real array, with the internal
 * anchors the published document leaves out.
 */
import { REFUSALS, refusalsDocument } from "../src/refusals.ts";

console.log(JSON.stringify({ refusals: REFUSALS, document: refusalsDocument("https://example.test") }));
