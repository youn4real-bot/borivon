/* Borivon analytics + consent for the static pages (founder 2026-11-09: "only what is legal in Germany").
   Nothing is measured in the browser before "Akzeptieren" (§ 25 TDDDG, Art. 6(1)(a) DSGVO). Without
   consent the page only passes the link's own src/utm on to a form the visitor sends. "Ablehnen" is as
   easy as "Akzeptieren", nothing is pre-ticked, Impressum + Datenschutz stay reachable, and any element
   with data-consent-open (footer: "Datenschutz-Einstellungen") reopens the choice. Never a form value. */
(function () {
  "use strict";
  var KEY = "bv_consent", VID = "bv_vid", YEAR = 395 * 864e5;
  function rid(n) { var a = new Uint8Array(n); (window.crypto || window.msCrypto).getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* blocked */ } }
  function readConsent() {
    try { var c = JSON.parse(get(KEY) || "null"); if (c && c.v === 1 && Date.now() - c.t < YEAR) return c; } catch (e) { /* none */ }
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

  /* ── the choice ── */
  var css = "#bv-consent{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;justify-content:center;padding:0 12px 12px;pointer-events:none;font-family:Inter,'Segoe UI',system-ui,sans-serif}" +
    "#bv-consent .c{pointer-events:auto;max-width:620px;width:100%;background:#fbfaf6;color:#15130f;border:1px solid #ddd6c8;border-radius:6px;box-shadow:0 26px 60px -24px rgba(0,0,0,.42);padding:20px 20px 16px;font-size:15px;line-height:1.55}" +
    "#bv-consent h2{margin:0 0 6px;font:500 21px/1.2 'EB Garamond',Georgia,serif;letter-spacing:-.01em}" +
    "#bv-consent p{margin:0 0 14px;color:#3b372f}#bv-consent a{color:#8a6a28}" +
    "#bv-consent .b{display:flex;gap:10px}#bv-consent button{flex:1;cursor:pointer;font:500 15px Inter,'Segoe UI',system-ui,sans-serif;padding:13px 10px;border-radius:3px;border:1px solid #15130f;background:#fbfaf6;color:#15130f}" +
    "#bv-consent button:hover{background:#f4f1ea}#bv-consent .l{margin:12px 0 0;font-size:13px;text-align:center}" +
    "@media (max-width:520px){#bv-consent{padding:0}#bv-consent .c{border-radius:18px 18px 0 0}}";
  function showBanner() {
    if (document.getElementById("bv-consent")) return;
    if (!document.getElementById("bv-consent-css")) { var s = document.createElement("style"); s.id = "bv-consent-css"; s.textContent = css; document.head.appendChild(s); }
    var d = document.createElement("div");
    d.id = "bv-consent";
    d.innerHTML = '<div class="c" role="dialog" aria-labelledby="bvc-h" aria-describedby="bvc-p">' +
      '<h2 id="bvc-h">Dürfen wir messen, wie Sie die Seite nutzen?</h2>' +
      '<p id="bvc-p">Mit Ihrer Einwilligung erfassen wir, welche Seiten Sie öffnen, was Sie anklicken, welche Formularschritte Sie erreichen (nie, was Sie eintippen) und ob Sie wiederkommen. Dafür speichern wir eine zufällige Kennung in Ihrem Browser (13 Monate). Gespeichert nur bei uns, ohne Werbung, ohne Weitergabe. Sie können jederzeit über „Datenschutz-Einstellungen“ unten auf der Seite widerrufen. <a href="/datenschutz">Mehr erfahren</a></p>' +
      '<div class="b"><button type="button" data-c="0">Ablehnen</button><button type="button" data-c="1">Akzeptieren</button></div>' +
      '<p class="l"><a href="/datenschutz">Datenschutz</a> · <a href="/impressum">Impressum</a></p></div>';
    document.body.appendChild(d);
    d.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button[data-c]");
      if (!b) return;
      var yes = b.getAttribute("data-c") === "1";
      consentId = rid(12);
      set(KEY, JSON.stringify({ v: 1, s: yes ? 1 : 0, t: Date.now(), id: consentId }));
      d.remove();
      if (yes) { start(); ev("consent", "statistik", consentId); send(false); } else stop();
    });
  }
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("[data-consent-open]");
    if (a) { e.preventDefault(); showBanner(); }
  });

  var c = readConsent();
  if (c && c.s === 1) start();
  else if (!c) {
    if (document.body) showBanner(); else document.addEventListener("DOMContentLoaded", showBanner);
  }
})();
