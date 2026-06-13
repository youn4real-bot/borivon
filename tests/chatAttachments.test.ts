import { describe, it, expect } from "vitest";
import { chatAttachmentKey, extFromMime, loadChatAttachmentBytes } from "../lib/chatAttachments";

// 8-byte PNG signature → a minimal data URL that passes validateImageDataUrl
// (magic-byte sniff + length check). base64("89 50 4E 47 0D 0A 1A 0A").
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

describe("chatAttachmentKey (path-traversal safety)", () => {
  it("builds chat/<thread>/<id>.<ext>", () => {
    expect(chatAttachmentKey("user-1", "abc", "image/png")).toBe("chat/user-1/abc.png");
  });

  it("strips traversal from the unique id so it can't escape the chat/ prefix", () => {
    const key = chatAttachmentKey("user-1", "../../etc/passwd", "image/jpeg");
    expect(key.split("/")).toHaveLength(3); // chat / <thread> / <id>.<ext>
    expect(key.startsWith("chat/user-1/")).toBe(true);
    expect(key).not.toContain("/etc/");
  });

  it("keeps a crafted thread id within a single segment under chat/", () => {
    const key = chatAttachmentKey("../evil", "id", "image/png");
    expect(key.split("/")).toHaveLength(3); // chat / <thread-seg> / <id>.<ext>
    expect(key.startsWith("chat/")).toBe(true);
    // the slash was stripped, so "../" can never act as a path component
    expect(key).not.toContain("../");
  });

  it("maps mime → extension, defaulting to bin", () => {
    expect(extFromMime("image/png")).toBe("png");
    expect(extFromMime("image/jpeg")).toBe("jpg");
    expect(extFromMime("image/webp")).toBe("webp");
    expect(extFromMime("image/gif")).toBe("gif");
    expect(extFromMime("application/x-evil")).toBe("bin");
  });
});

describe("loadChatAttachmentBytes (legacy + empty back-compat)", () => {
  it("returns null when the message has no attachment", async () => {
    expect(await loadChatAttachmentBytes({ attachment: null, attachment_key: null, attachment_mime: null })).toBeNull();
  });

  it("decodes a legacy inline base64 data URL to bytes + mime", async () => {
    const out = await loadChatAttachmentBytes({ attachment: PNG_DATA_URL, attachment_key: null, attachment_mime: null });
    expect(out).not.toBeNull();
    expect(out!.mime).toBe("image/png");
    expect(out!.bytes[0]).toBe(0x89); // PNG signature first byte
  });

  it("returns null for a malformed legacy data URL (never throws)", async () => {
    expect(await loadChatAttachmentBytes({ attachment: "data:image/svg+xml,<svg/>", attachment_key: null, attachment_mime: null })).toBeNull();
  });
});
