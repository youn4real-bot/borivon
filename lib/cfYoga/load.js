// @ts-nocheck
// Cloudflare-Workers yoga-layout loader. workerd BANS runtime WASM codegen
// (WebAssembly.instantiate(bytes)/compile), which is how yoga-layout v3's default
// `yoga-layout/load` works (SINGLE_FILE base64 → runtime instantiate). Here we instead feed
// yoga a STATICALLY-imported wasm module (wrangler compiles it at deploy time — allowed) via
// emscripten's `instantiateWasm` override hook. Aliased over `yoga-layout/load` on the
// CLOUDFLARE build only (next.config.ts, gated on CF_BUILD) so Vercel's CV rendering is
// byte-for-byte unchanged. Mirrors yoga-layout/dist/src/load.js's wrapAssembly usage so
// @react-pdf/layout (which imports `yoga-layout/load`) gets the exact interface it expects.
import loadYogaImpl from "yoga-layout/dist/binaries/yoga-wasm-base64-esm.js";
import wrapAssembly from "yoga-layout/dist/src/wrapAssembly.js";
// Static import → wrangler provides a compiled WebAssembly.Module (no runtime codegen).
import yogaWasmModule from "./yoga.wasm";

export async function loadYoga() {
  const instance = await loadYogaImpl({
    // emscripten calls this instead of doing its own (banned) instantiation.
    instantiateWasm(imports, successCallback) {
      const inst = new WebAssembly.Instance(yogaWasmModule, imports);
      successCallback(inst);
      return inst.exports;
    },
  });
  return wrapAssembly(instance);
}

export * from "yoga-layout/dist/src/generated/YGEnums.js";
