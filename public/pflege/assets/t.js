/* Borivon analytics + consent for the static pages (founder 2026-11-09: "only what is legal in Germany").
   Nothing is measured in the browser before "Akzeptieren" (§ 25 TDDDG, Art. 6(1)(a) DSGVO). Without
   consent the page only passes the link's own src/utm on to a form the visitor sends. "Ablehnen" is as
   easy as "Akzeptieren", nothing is pre-ticked, Impressum + Datenschutz stay reachable, and any element
   with data-consent-open (footer: "Datenschutz-Einstellungen") reopens the choice. Never a form value. */
(function () {
  "use strict";
  var KEY = "bv_consent", VID = "bv_vid", YEAR = 395 * 864e5, HALF = 183 * 864e5; /* a "Nur notwendige" is asked again after 6 months */
  function rid(n) { var a = new Uint8Array(n); (window.crypto || window.msCrypto).getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* blocked */ } }
  function readConsent() {
    try { var c = JSON.parse(get(KEY) || "null"); if (c && c.v === 1 && Date.now() - c.t < (c.s === 1 ? YEAR : HALF)) return c; } catch (e) { /* none */ }
    return null;
  }

  var q = new URLSearchParams(location.search);
  /* What a sent form may carry even without consent: the link's own parameters (no device data). */
  var ctx = {
    path: location.pathname.replace(/\.html$/, "").replace(/\/index$/, "/") || "/",
    src: q.get("src") || q.get("utm_source") || q.get("via") || "",
    utm: ["utm_medium", "utm_campaign", "utm_content", "utm_term"].map(function (k) { return q.get(k) || ""; }).join("|").replace(/^\|+$/, ""),
    lid: q.get("lid") || "",
    sid: rid(9)
  };
  window.bvTrackContext = ctx;
  window.bvTrack = function () {};

  /* ── measuring: only after "Akzeptieren" ── */
  var started = false, queue = [], t0 = Date.now(), consentId = "";
  function send(beacon) {
    if (!queue.length || !started) return;
    var now = Date.now(), evs = queue.splice(0, 60).map(function (e) { return { type: e.type, name: e.name, value: e.value, ago: now - e.t }; });
    var body = JSON.stringify({ c: 1, path: ctx.path, src: ctx.src, utm: ctx.utm, ref: ctx.ref, lid: ctx.lid, lang: ctx.lang, screen: ctx.screen, sid: ctx.sid, vid: ctx.vid, events: evs });
    try {
      if (beacon && navigator.sendBeacon && navigator.sendBeacon("/api/t", new Blob([body], { type: "application/json" }))) return;
      fetch("/api/t", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }).catch(function () {});
    } catch (e) { /* never break the page */ }
  }
  function ev(type, name, value) {
    if (!started) return;
    queue.push({ type: type, name: name == null ? "" : String(name).slice(0, 80), value: value == null ? "" : String(value).slice(0, 200), t: Date.now() });
    if (queue.length >= 25) send(false);
  }
  function start() {
    if (started || get("bv_no_track") === "1") return;
    started = true;
    var v = get(VID), vt = Number(get(VID + "_t")) || 0;
    if (!v || !/^[0-9a-f]{32}$/.test(v) || Date.now() - vt > YEAR) { v = rid(16); set(VID, v); set(VID + "_t", String(Date.now())); }
    ctx.vid = v;
    ctx.ref = document.referrer || "";
    ctx.lang = (navigator.language || "").slice(0, 16);
    ctx.screen = (screen.width || 0) + "x" + (screen.height || 0);
    window.bvTrack = ev;
    ev("view", document.title);
    setTimeout(function () { send(false); }, 1500);
    setInterval(function () { send(false); }, 15000);
  }
  function stop() {
    started = false; queue = []; window.bvTrack = function () {};
    set(VID, null); set(VID + "_t", null);
    delete ctx.vid; delete ctx.ref; delete ctx.lang; delete ctx.screen;
  }

  /* how far down they read */
  var marks = [25, 50, 75, 100], seen = {}, ticking = false;
  function depth() {
    ticking = false;
    var h = document.documentElement, max = Math.max(1, h.scrollHeight - innerHeight), pct = Math.round(100 * (scrollY || h.scrollTop) / max);
    marks.forEach(function (m) { if (pct >= m - 2 && !seen[m]) { seen[m] = 1; ev("scroll", m); } });
  }
  addEventListener("scroll", function () { if (started && !ticking) { ticking = true; setTimeout(depth, 250); } }, { passive: true });
  /* what they click: links and buttons (their label, never form contents) */
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest && e.target.closest("a,button,[data-track]");
    if (!started || !el || el.closest("#bv-consent") || el.closest("form") && el.tagName === "BUTTON" && el.type !== "submit") return;
    var label = (el.getAttribute("data-track") || el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
    ev("cta", label, el.tagName === "A" ? (el.getAttribute("href") || "") : "");
  }, true);
  /* forms: which field was entered, and whether it was left filled. Never the value. */
  function fieldName(el) { return (el.name || el.id || el.getAttribute("aria-label") || el.type || "field").slice(0, 60); }
  function isField(el) { return el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== "hidden" && !el.closest("#bv-consent"); }
  document.addEventListener("focusin", function (e) { if (isField(e.target)) ev("field_focus", fieldName(e.target)); });
  document.addEventListener("focusout", function (e) {
    var el = e.target; if (!isField(el)) return;
    var filled = el.type === "checkbox" || el.type === "radio" ? el.checked : !!(el.value && String(el.value).trim());
    ev("field_done", fieldName(el), filled ? "1" : "0");
  });
  /* leaving: how long they stayed */
  var left = false;
  addEventListener("pagehide", function () { if (left) return; left = true; ev("leave", "", Date.now() - t0); send(true); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") send(true); else left = false; });

  /* ── the choice (founder 2026-11-12, sample 3): a centred box, two equal buttons. Legal per VG Hannover
     19.03.2025 / LfD Niedersachsen: "Einwilligung", the purpose, no third parties and "Jederzeit widerrufbar"
     on the first screen; "Nur notwendige" is one click and looks exactly like "Akzeptieren"; nothing
     pre-ticked; details + the switch behind "Einstellungen"; Datenschutz + Impressum always one tap away
     (and never covered on their own pages). Shown after the first scroll or 4 s; never an X. ── */
  var css = "#bv-consent{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;font-family:Inter,'Segoe UI',system-ui,sans-serif}" +
    "#bv-consent .bd{position:absolute;inset:0;background:rgba(21,19,15,.26);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}" +
    "#bv-consent .c{position:relative;width:100%;max-width:430px;max-height:calc(100dvh - 32px);overflow:auto;background:#fbfaf6;color:#15130f;border:1px solid #ddd6c8;border-radius:20px;box-shadow:0 26px 60px -24px rgba(0,0,0,.42);padding:26px 24px 14px;font-size:14px;line-height:1.5;text-align:center}" +
    "#bv-consent h2{margin:0 0 6px;font:500 26px/1.15 'EB Garamond',Georgia,serif;letter-spacing:-.01em;color:#15130f}" +
    "#bv-consent p{margin:0;color:#3b372f}#bv-consent a{color:#8a8478;text-decoration:underline;text-underline-offset:2px;cursor:pointer}" +
    "#bv-consent .b{display:flex;flex-direction:column;gap:10px;margin-top:18px}" +
    "#bv-consent .b button{cursor:pointer;font:500 15px Inter,'Segoe UI',system-ui,sans-serif;height:50px;border-radius:10px;border:1px solid #15130f;background:#15130f;color:#fbfaf6}" +
    "#bv-consent .b button:hover{background:#2c2822}#bv-consent .l{margin:12px 0 0;font-size:12px;color:#8a8478}" +
    "#bv-consent .r{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 0;border-top:1px solid #e7e1d5;text-align:left}" +
    "#bv-consent .r b{display:block;font-size:14.5px;font-weight:600}#bv-consent .r small{display:block;font-size:12.5px;color:#8a8478;line-height:1.4}" +
    "#bv-consent .on{font-size:12px;color:#16a34a;font-weight:600;white-space:nowrap}" +
    "#bv-consent button.tg{flex:none;cursor:pointer;width:44px;height:26px;border-radius:99px;background:#e7e1d5;border:0;padding:0;position:relative}" +
    "#bv-consent button.tg:after{content:'';position:absolute;left:3px;top:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .15s}" +
    "#bv-consent button.tg[aria-checked=true]{background:#15130f}#bv-consent button.tg[aria-checked=true]:after{transform:translateX(18px)}" +
    "@media (max-width:520px){#bv-consent .c{padding:22px 18px 12px}#bv-consent h2{font-size:24px}}";
  var LINKS = '<a href="/datenschutz">Datenschutz</a> · <a href="/impressum">Impressum</a>';
  var FIRST = '<h2 id="bvc-h">Cookies</h2>' +
    '<p id="bvc-p">Mit Ihrer Einwilligung messen wir, wie diese Seite genutzt wird – nur für unsere eigene Statistik. Keine Werbung, keine Weitergabe an Dritte. Jederzeit widerrufbar.</p>' +
    '<div class="b"><button type="button" data-c="1">Akzeptieren</button><button type="button" data-c="0">Nur notwendige</button></div>' +
    '<p class="l"><a data-set role="button" tabindex="0">Einstellungen</a> · ' + LINKS + '</p>';
  var SETTINGS = '<h2 id="bvc-h">Einstellungen</h2>' +
    '<div class="r"><span><b>Notwendig</b><small>Speichert nur Ihre Wahl in Ihrem Browser.</small></span><span class="on">Immer an</span></div>' +
    '<div class="r"><span><b>Statistik</b><small>Welche Seiten Sie öffnen, was Sie anklicken, welche Formularschritte Sie erreichen (nie, was Sie eintippen) und ob Sie wiederkommen. Dafür eine zufällige Kennung in Ihrem Browser (13 Monate). Nur bei uns, ohne Weitergabe.</small></span>' +
    '<button type="button" class="tg" role="switch" aria-checked="false" aria-label="Statistik"></button></div>' +
    '<div class="b"><button type="button" data-save>Auswahl speichern</button><button type="button" data-c="1">Akzeptieren</button></div>' +
    '<p class="l"><a data-back role="button" tabindex="0">Zurück</a> · ' + LINKS + '</p>';
  function decide(yes) {
    consentId = rid(12);
    set(KEY, JSON.stringify({ v: 1, s: yes ? 1 : 0, t: Date.now(), id: consentId }));
    var d = document.getElementById("bv-consent");
    if (d) d.remove();
    if (yes) { start(); ev("consent", "statistik", consentId); send(false); } else stop();
  }
  function showBanner() {
    if (document.getElementById("bv-consent")) return;
    if (!document.getElementById("bv-consent-css")) { var st = document.createElement("style"); st.id = "bv-consent-css"; st.textContent = css; document.head.appendChild(st); }
    var d = document.createElement("div");
    d.id = "bv-consent";
    d.innerHTML = '<div class="bd"></div><div class="c" role="dialog" aria-modal="true" aria-labelledby="bvc-h" aria-describedby="bvc-p"></div>';
    var box = d.querySelector(".c");
    box.innerHTML = FIRST;
    document.body.appendChild(d);
    try { box.querySelector("button").focus({ preventScroll: true }); } catch (e) { /* old browser */ }
    function act(e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var b = t.closest("button[data-c]");
      if (b) { decide(b.getAttribute("data-c") === "1"); return; }
      if (t.closest("[data-set]")) { e.preventDefault(); box.innerHTML = SETTINGS; return; }
      if (t.closest("[data-back]")) { e.preventDefault(); box.innerHTML = FIRST; return; }
      var g = t.closest("button.tg");
      if (g) { g.setAttribute("aria-checked", g.getAttribute("aria-checked") === "true" ? "false" : "true"); return; }
      if (t.closest("[data-save]")) { var tg = box.querySelector("button.tg"); decide(!!tg && tg.getAttribute("aria-checked") === "true"); }
    }
    d.addEventListener("click", act);
    d.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && e.target && e.target.matches && e.target.matches("a[data-set],a[data-back]")) act(e); });
  }
  /* first visit: wait for the first scroll (or 4 s) — never on Datenschutz / Impressum themselves */
  function showSoon() {
    if (/^\/(datenschutz|impressum)/.test(location.pathname)) return;
    var done = false, tm;
    function go() { if (done) return; done = true; removeEventListener("scroll", go); clearTimeout(tm); showBanner(); }
    addEventListener("scroll", go, { passive: true });
    tm = setTimeout(go, 4000);
  }
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("[data-consent-open]");
    if (a) { e.preventDefault(); showBanner(); }
  });

  var c = readConsent();
  if (c && c.s === 1) start();
  else if (!c) {
    if (document.body) showSoon(); else document.addEventListener("DOMContentLoaded", showSoon);
  }
})();
