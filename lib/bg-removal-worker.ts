// Runs inside a Web Worker — keeps main thread responsive during AI inference
import { removeBackground } from "@imgly/background-removal";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = self as any;

ctx.onmessage = async function (e: MessageEvent<string>) {
  try {
    const blob = await removeBackground(e.data, {
      output: { format: "image/png" },
    });
    const reader = new FileReader();
    reader.onloadend = () => {
      ctx.postMessage({ ok: true, dataUri: reader.result as string });
    };
    reader.readAsDataURL(blob);
  } catch {
    ctx.postMessage({ ok: false });
  }
};
