import { describe, it, expect } from "vitest";
import { installPdfjsPolyfills, PDFJS_POLYFILLED_APIS } from "@/lib/pdfjsPolyfills";

/**
 * The two APIs pdf.js 6 stopped polyfilling (lib/pdfjsPolyfills.ts). Node has
 * both natively, so each test builds a fake "old Safari" global — a Promise
 * subclass and an ArrayBuffer subclass with the method hidden — and installs
 * onto that, never onto the real globals the rest of the suite runs on.
 */

function oldSafari() {
  class OldPromise<T> extends Promise<T> {}
  Object.defineProperty(OldPromise, "withResolvers", { value: undefined, configurable: true, writable: true });
  class OldArrayBuffer extends ArrayBuffer {}
  Object.defineProperty(OldArrayBuffer.prototype, "transferToFixedLength", { value: undefined, configurable: true, writable: true });
  return {
    Promise: OldPromise as unknown as PromiseConstructor,
    ArrayBuffer: OldArrayBuffer as unknown as ArrayBufferConstructor,
  };
}

describe("installPdfjsPolyfills", () => {
  it("installs nothing on a browser that has both (every current one)", () => {
    expect(installPdfjsPolyfills({ Promise, ArrayBuffer })).toEqual([]);
  });

  it("installs both on an iPhone below iOS 17.4, and says so", () => {
    expect(installPdfjsPolyfills(oldSafari())).toEqual([...PDFJS_POLYFILLED_APIS]);
  });

  it("is idempotent — the second call finds them present", () => {
    const g = oldSafari();
    installPdfjsPolyfills(g);
    expect(installPdfjsPolyfills(g)).toEqual([]);
  });

  it("never replaces a function that already exists", () => {
    const g = oldSafari();
    const mine = () => "native";
    Object.defineProperty(g.Promise, "withResolvers", { value: mine, configurable: true, writable: true });
    installPdfjsPolyfills(g);
    expect((g.Promise as unknown as { withResolvers: unknown }).withResolvers).toBe(mine);
  });

  it("Promise.withResolvers behaves like the spec method pdf.js calls", async () => {
    const g = oldSafari();
    installPdfjsPolyfills(g);
    const P = g.Promise as unknown as PromiseConstructor & {
      withResolvers<T>(): { promise: Promise<T>; resolve(v: T): void; reject(r?: unknown): void };
    };
    const ok = P.withResolvers<number>();
    expect(ok.promise).toBeInstanceOf(g.Promise);   // honours `this`, like the spec
    ok.resolve(42);
    await expect(ok.promise).resolves.toBe(42);

    const bad = P.withResolvers<number>();
    bad.reject(new Error("nope"));
    await expect(bad.promise).rejects.toThrow("nope");

    // Not enumerable — the polyfill must not show up in for-in over Promise.
    expect(Object.keys(g.Promise)).not.toContain("withResolvers");
  });

  it("transferToFixedLength shrinks, grows and copies the way pdf.js uses it", () => {
    const g = oldSafari();
    installPdfjsPolyfills(g);
    type T = ArrayBuffer & { transferToFixedLength(n?: number): ArrayBuffer };
    const src = new g.ArrayBuffer(8) as T;
    new Uint8Array(src).set([1, 2, 3, 4, 5, 6, 7, 8]);

    // compileFontInfo: allocate generously, then trim to what was written.
    const trimmed = src.transferToFixedLength(5);
    expect(trimmed.byteLength).toBe(5);
    expect([...new Uint8Array(trimmed)]).toEqual([1, 2, 3, 4, 5]);

    const same = src.transferToFixedLength();
    expect([...new Uint8Array(same)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const grown = src.transferToFixedLength(10);
    expect([...new Uint8Array(grown)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0, 0]);

    expect(() => src.transferToFixedLength(-1)).toThrow(RangeError);
    // A copy, never a view: writing the result must not touch the source.
    new Uint8Array(trimmed)[0] = 99;
    expect(new Uint8Array(src)[0]).toBe(1);
  });

  it("transferToFixedLength's result survives structuredClone transfer (the main-thread message path)", () => {
    // On the main-thread plan pdf.js hands the font buffer to LoopbackPort,
    // which calls structuredClone(obj, { transfer }). The polyfilled result is
    // a plain ArrayBuffer, so that must work.
    const g = oldSafari();
    installPdfjsPolyfills(g);
    const src = new g.ArrayBuffer(4) as ArrayBuffer & { transferToFixedLength(n?: number): ArrayBuffer };
    new Uint8Array(src).set([9, 8, 7, 6]);
    const out = src.transferToFixedLength(3);
    const cloned = structuredClone(out, { transfer: [out] });
    expect([...new Uint8Array(cloned)]).toEqual([9, 8, 7]);
    expect(out.byteLength).toBe(0);   // transferred away, as pdf.js expects
  });
});
