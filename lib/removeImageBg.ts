"use client";

import { removeBackground } from "@imgly/background-removal";

/**
 * Remove background from an image data URI using the @imgly/background-removal
 * ONNX/WASM model (battle-tested OSS, LAW #28). Returns the cleaned PNG as a
 * data URI. If inference fails, falls back to the original input so callers
 * never break.
 */
export async function removeImageBg(dataUri: string): Promise<string> {
  try {
    const blob = await removeBackground(dataUri, { output: { format: "image/png" } });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return dataUri;
  }
}
