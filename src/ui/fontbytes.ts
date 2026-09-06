/**
 * The font files themselves.
 *
 * Separate from fontfaces.ts because these are binary modules (a Data rule in
 * wrangler.jsonc) and importing one under Node — which the test runner does,
 * transitively, through the shell — fails with an unknown file extension. The
 * CSS is a string and can live anywhere; the bytes are needed only by the
 * route that serves them.
 */

import ibm_plex_mono_400_latin_ext from "./fonts/ibm-plex-mono-400-latin-ext.woff2";
import ibm_plex_mono_400_latin from "./fonts/ibm-plex-mono-400-latin.woff2";
import ibm_plex_mono_500_latin_ext from "./fonts/ibm-plex-mono-500-latin-ext.woff2";
import ibm_plex_mono_500_latin from "./fonts/ibm-plex-mono-500-latin.woff2";
import ibm_plex_mono_600_latin_ext from "./fonts/ibm-plex-mono-600-latin-ext.woff2";
import ibm_plex_mono_600_latin from "./fonts/ibm-plex-mono-600-latin.woff2";
import instrument_sans_400_700_latin_ext from "./fonts/instrument-sans-400-700-latin-ext.woff2";
import instrument_sans_400_700_latin from "./fonts/instrument-sans-400-700-latin.woff2";

/** name -> bytes, for the /fonts route. */
export const FONT_FILES: Record<string, ArrayBuffer> = {
  "ibm-plex-mono-400-latin-ext.woff2": ibm_plex_mono_400_latin_ext,
  "ibm-plex-mono-400-latin.woff2": ibm_plex_mono_400_latin,
  "ibm-plex-mono-500-latin-ext.woff2": ibm_plex_mono_500_latin_ext,
  "ibm-plex-mono-500-latin.woff2": ibm_plex_mono_500_latin,
  "ibm-plex-mono-600-latin-ext.woff2": ibm_plex_mono_600_latin_ext,
  "ibm-plex-mono-600-latin.woff2": ibm_plex_mono_600_latin,
  "instrument-sans-400-700-latin-ext.woff2": instrument_sans_400_700_latin_ext,
  "instrument-sans-400-700-latin.woff2": instrument_sans_400_700_latin,
};

