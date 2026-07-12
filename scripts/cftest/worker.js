// Throwaway smoke-test Worker — proves the deploy pipeline (token → wrangler → Cloudflare →
// live workers.dev URL) works end to end. Deleted once the real bot is deployed. Not part of
// the app; lives in scripts/ and is deployed standalone via scripts/cftest/wrangler.jsonc.
export default {
  async fetch() {
    return new Response("Borivon → Cloudflare test OK. The deploy pipeline works.\n", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
