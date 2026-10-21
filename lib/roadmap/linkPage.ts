/** Tiny self-contained answer page for the confirm / unsubscribe links. */
export function linkPage(
  lang: string,
  title: string,
  body: string,
  status = 200,
  /** A same-URL POST button instead of the "back" link (used by the confirm step). */
  form?: { label: string },
): Response {
  const back = lang === "fr" ? "Retour à borivon.com" : lang === "en" ? "Back to borivon.com" : "Zurück zu borivon.com";
  const action = form
    ? `<form method="post"><button type="submit">${form.label}</button></form>`
    : `<a href="https://borivon.com/">${back}</a>`;
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Borivon</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e0e10;color:#eeecea;font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:24px}
.c{max-width:440px;text-align:center}.w{font-family:Georgia,serif;font-style:italic;font-size:26px;margin-bottom:26px}.w span{color:#c9a240}
h1{font-size:22px;font-weight:600;margin:0 0 10px}p{color:#a8a6a3;line-height:1.6;margin:0 0 24px}
a,button{display:inline-block;color:#131312;background:#c9a240;text-decoration:none;font:inherit;font-weight:600;padding:12px 22px;border-radius:999px;border:0;cursor:pointer}</style></head>
<body><div class="c"><div class="w">Borivon<span>.</span></div><h1>${title}</h1><p>${body}</p>${action}</div></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
