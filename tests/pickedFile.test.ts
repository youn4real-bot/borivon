import { describe, it, expect } from "vitest";
import { stabilizePickedFile, SNAPSHOT_MAX_BYTES } from "@/lib/pickedFile";

/** Uint8Array → BlobPart. TS models Uint8Array over ArrayBufferLike, which is
 *  not assignable to BlobPart under this tsconfig; the value is a valid part. */
const part = (u8: Uint8Array): BlobPart => u8 as unknown as BlobPart;

/** A File whose bytes can be read exactly `reads` times, then the handle dies —
 *  the behaviour of a camera capture whose temp copy the OS has reclaimed. */
function dyingFile(bytes: Uint8Array, name: string, type: string, reads = 1): File {
  const real = new File([part(bytes)], name, { type, lastModified: 1_700_000_000_000 });
  let left = reads;
  const dead = () => {
    const e = new Error("The operation is insecure.");
    e.name = "NotReadableError";
    return e;
  };
  return Object.create(real, {
    arrayBuffer: {
      value: async () => {
        if (left-- <= 0) throw dead();
        return real.arrayBuffer();
      },
    },
    slice: {
      value: (...args: unknown[]) => {
        if (left <= 0) {
          return { arrayBuffer: async () => { throw dead(); } };
        }
        return (real.slice as (...a: never[]) => Blob)(...(args as never[]));
      },
    },
  }) as File;
}

describe("stabilizePickedFile", () => {
  it("copies the bytes so the upload no longer depends on the OS handle", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]); // JPEG magic
    const res = await stabilizePickedFile(dyingFile(bytes, "pass.jpg", "image/jpeg", 1));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.copied).toBe(true);
    expect(new Uint8Array(await res.file.arrayBuffer())).toEqual(bytes);
  });

  it("LAW #39: the copy is byte-identical — nothing is parsed or re-saved", async () => {
    // A scanner-produced passport PDF must arrive exactly as picked.
    const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
    const res = await stabilizePickedFile(new File([part(pdf)], "reisepass.pdf", { type: "application/pdf" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(new Uint8Array(await res.file.arrayBuffer())).toEqual(pdf);
    expect(res.file.size).toBe(pdf.byteLength);
  });

  it("keeps name, type and lastModified so the server still names the file correctly", async () => {
    const f = new File([part(new Uint8Array([1, 2, 3]))], "scan.png", { type: "image/png", lastModified: 42 });
    const res = await stabilizePickedFile(f);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.file.name).toBe("scan.png");
    expect(res.file.type).toBe("image/png");
    expect(res.file.lastModified).toBe(42);
  });

  it("the snapshot can be sent more than once — a retry re-reads it fine", async () => {
    // The whole point: the old retry re-used the original handle, so when the
    // handle was the problem the retry failed in exactly the same way.
    const bytes = new Uint8Array([9, 8, 7, 6]);
    const res = await stabilizePickedFile(dyingFile(bytes, "a.jpg", "image/jpeg", 1));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(new Uint8Array(await res.file.arrayBuffer())).toEqual(bytes);
    expect(new Uint8Array(await res.file.arrayBuffer())).toEqual(bytes);
    expect(new Uint8Array(await res.file.arrayBuffer())).toEqual(bytes);
  });

  it("reports an already-dead pick up front instead of as a mystery network error", async () => {
    const res = await stabilizePickedFile(dyingFile(new Uint8Array([1]), "gone.jpg", "image/jpeg", 0));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toContain("NotReadableError");
  });

  it("refuses a truncated read rather than uploading a corrupt scan", async () => {
    const real = new File([part(new Uint8Array(1000))], "short.jpg", { type: "image/jpeg" });
    const truncated = Object.create(real, {
      arrayBuffer: { value: async () => new ArrayBuffer(400) },
    }) as File;
    const res = await stabilizePickedFile(truncated);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("short-read:400/1000");
  });

  it("streams the very largest scans from the handle, but still proves it is readable", async () => {
    const big = new File([part(new Uint8Array(64))], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: SNAPSHOT_MAX_BYTES + 1 });
    const res = await stabilizePickedFile(big);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.copied).toBe(false);
    expect(res.file).toBe(big);
  });

  it("fails a too-large file whose handle is already dead", async () => {
    const big = dyingFile(new Uint8Array(64), "big.pdf", "application/pdf", 0);
    Object.defineProperty(big, "size", { value: SNAPSHOT_MAX_BYTES + 1 });
    const res = await stabilizePickedFile(big);
    expect(res.ok).toBe(false);
  });

  it("falls back to streaming when the phone cannot allocate the copy", async () => {
    // Out of memory must not be reported as "your photo is gone" — the upload
    // can still succeed straight from the handle.
    const real = new File([part(new Uint8Array(8))], "huge.jpg", { type: "image/jpeg" });
    const oom = Object.create(real, {
      arrayBuffer: { value: async () => { throw new RangeError("Array buffer allocation failed"); } },
    }) as File;
    const res = await stabilizePickedFile(oom);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.copied).toBe(false);
  });
});
