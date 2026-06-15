import { describe, it, expect } from "vitest";
import { nameFromChatKey } from "@/lib/chatUploads";

describe("nameFromChatKey — recover attachment name from a chat-upload R2 key", () => {
  it("uses the original name after '__' (new keys)", () => {
    expect(nameFromChatKey("chat-uploads/abc-123/9f8e__96744.jpg")).toBe("96744.jpg");
    expect(nameFromChatKey("chat-uploads/u/uuid__Oumha,_M._Defizitbescheid.pdf")).toBe("Oumha,_M._Defizitbescheid.pdf");
  });
  it("falls back to the base for legacy keys (no '__')", () => {
    expect(nameFromChatKey("chat-uploads/u/d4f1a2b3.jpg")).toBe("d4f1a2b3.jpg");
  });
  it("never returns empty", () => {
    expect(nameFromChatKey("chat-uploads/u/uuid__")).toBe("datei");
    expect(nameFromChatKey("")).toBe("datei");
  });
});
