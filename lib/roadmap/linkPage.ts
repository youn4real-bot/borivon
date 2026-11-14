/** Tiny self-contained answer page for the confirm / unsubscribe links. */
export function linkPage(
  lang: string,
  title: string,
  body: string,
  status = 200,
  /** A same-URL POST button instead of the "back" link (used by the confirm step). */
  form?: { label: string },
  /** A link button instead of the "back" link ("open your Fahrplan"). */
  link?: { label: string; href: string },
): Response {
  const back = lang === "fr" ? "Retour à borivon.com" : lang === "en" ? "Back to borivon.com" : "Zurück zu borivon.com";
  const action = form
    ? `<form method="post"><button type="submit">${form.label}</button></form>`
    : link ? `<a href="${link.href.replace(/"/g, "&quot;")}">${link.label}</a>`
    : `<a href="https://borivon.com/">${back}</a>`;
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Borivon</title>
<style>@font-face{font-family:"EB Garamond";font-style:normal;font-weight:400 800;font-display:swap;src:url(/pflege/assets/fonts/ebgaramond-latin.woff2) format("woff2")}
@font-face{font-family:"EB Garamond";font-style:italic;font-weight:400 800;font-display:swap;src:url(/pflege/assets/fonts/ebgaramond-italic-latin.woff2) format("woff2")}
@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url(/pflege/assets/fonts/inter-latin.woff2) format("woff2")}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f1ea;color:#3b372f;font-family:Inter,"Segoe UI",system-ui,sans-serif;font-size:17px;padding:24px;-webkit-font-smoothing:antialiased}
.c{max-width:470px;text-align:center}.w{font-family:"EB Garamond",Georgia,serif;font-style:italic;font-weight:500;font-size:30px;color:#15130f;margin-bottom:34px}.w span{color:#a8843a;font-style:normal}
h1{font-family:"EB Garamond",Georgia,serif;font-size:44px;font-weight:500;letter-spacing:-0.02em;line-height:1.05;color:#15130f;margin:0 0 16px}p{color:#3b372f;line-height:1.6;margin:0 0 30px}
a,button{display:inline-block;color:#f4f1ea;background:#15130f;text-decoration:none;font:500 16px/1 Inter,sans-serif;padding:21px 28px;border-radius:3px;border:0;cursor:pointer}</style></head>
<body><div class="c"><div class="w">Borivon<span>.</span></div><h1>${title}</h1><p>${body}</p>${action}</div></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
