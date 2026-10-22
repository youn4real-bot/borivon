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
<style>@font-face{font-family:"Playfair Display";font-style:normal;font-weight:400 900;font-display:swap;src:url(/pflege/assets/playfair-latin.woff2) format("woff2")}
@font-face{font-family:"Playfair Display";font-style:italic;font-weight:400;font-display:swap;src:url(/pflege/assets/playfair-italic-latin.woff2) format("woff2")}
@font-face{font-family:"Lexend";font-style:normal;font-weight:100 900;font-display:swap;src:url(/pflege/assets/lexend-latin.woff2) format("woff2")}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e0e10;color:#eeecea;font-family:Lexend,"Segoe UI",system-ui,sans-serif;padding:24px;-webkit-font-smoothing:antialiased}
.c{max-width:440px;text-align:center}.w{font-family:"Playfair Display",Georgia,serif;font-style:italic;font-size:28px;margin-bottom:26px}.w span{color:#c9a240;font-style:normal}
h1{font-family:"Playfair Display",Georgia,serif;font-size:30px;font-weight:500;letter-spacing:-0.02em;line-height:1.15;margin:0 0 12px}p{color:#9a978f;line-height:1.6;margin:0 0 24px}
a,button{display:inline-block;color:#131312;background:#c9a240;text-decoration:none;font:inherit;font-weight:600;padding:12px 22px;border-radius:999px;border:0;cursor:pointer}</style></head>
<body><div class="c"><div class="w">Borivon<span>.</span></div><h1>${title}</h1><p>${body}</p>${action}</div></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
