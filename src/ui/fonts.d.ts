/**
 * woff2 files are binary modules.
 *
 * wrangler.jsonc declares a Data rule for them, so an import yields the raw
 * bytes; TypeScript needs telling separately, or every font import is an
 * unresolved module. See src/ui/fontfaces.ts.
 */
declare module "*.woff2" {
  const bytes: ArrayBuffer;
  export default bytes;
}
