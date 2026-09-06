/**
 * The typefaces, served by us.
 *
 * Both faces were loaded from fonts.googleapis.com at runtime — a third-party
 * request on every page load, a hard dependency on a service we do not run,
 * and a flash of fallback type on a cold cache while a stylesheet round-trips
 * before the fonts it names can even start. Flagged as a launch concern in
 * docs/decisions/open-questions.md §3.
 *
 * The woff2 files are imported as binary modules (see "rules" in
 * wrangler.jsonc) rather than base64 strings, which would have inflated 98KB
 * of font into 130KB of source for nothing.
 *
 * The unicode-ranges are Google's own, kept verbatim: they are what stop a
 * browser downloading the latin-ext subset for a page that never shows an
 * accented character. Dropping them would make every visit heavier than the
 * thing this replaces.
 *
 * Instrument Sans is a VARIABLE font: one file per subset carries every weight
 * from 400 to 700, declared as a range so the browser interpolates rather than
 * faking bold. IBM Plex Mono is static and needs a file per weight.
 *
 * Generated once from the Google CSS. If a weight is ever used that has no file
 * here, the browser synthesises it — there is no fallback to the network.
 */

/*
 * SPLIT DELIBERATELY. This half is a string; src/ui/fontbytes.ts holds the
 * binary imports. The shell inlines the CSS into every page, and the shell is
 * reached by tests — which run under Node, where a .woff2 import is an
 * unknown file extension rather than a Data module. Only the /fonts route
 * needs the bytes, so only it pays for them.
 */

/** The @font-face block, inlined into every page's <style>. */
export const FONT_CSS = `@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/ibm-plex-mono-400-latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF}
@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/ibm-plex-mono-400-latin.woff2) format('woff2');unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD}
@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:500;font-display:swap;src:url(/fonts/ibm-plex-mono-500-latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF}
@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:500;font-display:swap;src:url(/fonts/ibm-plex-mono-500-latin.woff2) format('woff2');unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD}
@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:600;font-display:swap;src:url(/fonts/ibm-plex-mono-600-latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF}
@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:600;font-display:swap;src:url(/fonts/ibm-plex-mono-600-latin.woff2) format('woff2');unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD}
@font-face{font-family:'Instrument Sans';font-style:normal;font-weight:400 700;font-display:swap;src:url(/fonts/instrument-sans-400-700-latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF}
@font-face{font-family:'Instrument Sans';font-style:normal;font-weight:400 700;font-display:swap;src:url(/fonts/instrument-sans-400-700-latin.woff2) format('woff2');unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD}`;
