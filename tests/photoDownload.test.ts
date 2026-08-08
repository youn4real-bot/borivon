import { describe, it, expect } from "vitest";
import { profilePhotoFileName } from "@/lib/photoDownload";

const SUPA = "https://lobmtvfvrnlkngrqxgkb.supabase.co/storage/v1/object/public/profile-photos";

describe("profilePhotoFileName", () => {
  it("matches the house convention for candidate files", () => {
    expect(profilePhotoFileName("IKRAM AATMAN", `${SUPA}/abc.jpg`))
      .toBe("ikram_aatman_pflegekraft_foto.jpg");
  });

  it("keeps the real extension instead of guessing", () => {
    // A WebP saved as .jpg opens as a broken file on Windows.
    expect(profilePhotoFileName("A B", `${SUPA}/x.webp`)).toMatch(/\.webp$/);
    expect(profilePhotoFileName("A B", `${SUPA}/x.png`)).toMatch(/\.png$/);
    expect(profilePhotoFileName("A B", `${SUPA}/x.gif`)).toMatch(/\.gif$/);
  });

  it("normalises .jpeg to .jpg", () => {
    expect(profilePhotoFileName("A B", `${SUPA}/x.jpeg`)).toMatch(/\.jpg$/);
  });

  it("ignores the cache-busting query the upload route appends", () => {
    // Stored URLs really do look like "...jpg?t=1780241009".
    expect(profilePhotoFileName("Doha Zini", `${SUPA}/x.png?t=1780241009`))
      .toBe("doha_zini_pflegekraft_foto.png");
  });

  it("falls back to .jpg when the URL carries no extension", () => {
    expect(profilePhotoFileName("A B", `${SUPA}/no-extension-here`)).toMatch(/\.jpg$/);
  });

  it("transliterates German umlauts rather than dropping them", () => {
    expect(profilePhotoFileName("Jürgen Müller", `${SUPA}/x.jpg`))
      .toBe("juergen_mueller_pflegekraft_foto.jpg");
  });

  it("produces a safe filename from awkward names", () => {
    const out = profilePhotoFileName("  El  Gharib/../..  ", `${SUPA}/x.jpg`);
    expect(out).toBe("el_gharib_pflegekraft_foto.jpg");
    // No path separators or traversal can survive into a saved filename.
    expect(out).not.toMatch(/[/\\]|\.\./);
  });

  it("still yields a usable name when the candidate has none on file", () => {
    expect(profilePhotoFileName("", `${SUPA}/x.jpg`)).toBe("kandidat_pflegekraft_foto.jpg");
    expect(profilePhotoFileName("???", `${SUPA}/x.jpg`)).toBe("kandidat_pflegekraft_foto.jpg");
  });
});
