/**
 * Type declarations for mammoth's browser entry point.
 *
 * mammoth ships TypeScript types for its main entry, but not for the
 * `mammoth/mammoth.browser` build. We import the browser build to avoid
 * pulling in Node-only modules (fs, path, etc.) which would break the
 * client-side bundle.
 */
declare module "mammoth/mammoth.browser" {
  export interface ConvertResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<ConvertResult>;
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<ConvertResult>;
}
