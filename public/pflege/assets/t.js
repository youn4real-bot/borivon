/* Borivon first-party analytics for the static pages (founder 2026-11-09).
   No cookies, nothing stored on the device, no third party: one page load = one visit id in memory.
   Form fields are reported by NAME only (entered / filled), never what was typed.
   Pages can add their own steps with window.bvTrack(type, name, value). */
(function () {
  "use strict";
  try { if (localStorage.getItem("bv_no_track") === "1") { window.bvTrack = function () {}; return; } } catch (e) { /* storage blocked */ }
  var q = new URLSearchParams(location.search);
  var sid = (function () { var a = new Uint8Array(9); (window.crypto || window.msCrypto).getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); })();
  var ctx = {
    path: location.pathname.replace(/\.html$/, "").replace(/\/index$/, "/") || "/",
    src: q.get("src") || q.get("utm_source") || q.get("via") || "",
    utm: ["utm_medium", "utm_campaign", "utm_content", "utm_term"].map(function (k) { return q.get(k) || ""; }).join("|").replace(/^\|+$/, ""),
    ref: document.referrer || "",
    lid: q.get("lid") || "",
    lang: (navigator.language || "").slice(0, 16),
    screen: (screen.width || 0) + "x" + (screen.height || 0),
    sid: sid
  };
  window.bvTrackContext = ctx;
  var queue = [], t0 = Date.now();
  function send(beacon) {
    if (!queue.length) return;
    var now = Date.now(), evs = queue.splice(0, 60).map(function (e) { return { type: e.type, name: e.name, value: e.value, ago: now - e.t }; });
    var body = JSON.stringify({ path: ctx.path, src: ctx.src, utm: ctx.utm, ref: ctx.ref, lid: ctx.lid, lang: ctx.lang, screen: ctx.screen, sid: ctx.sid, events: evs });
    try {
      if (beacon && navigator.sendBeacon && navigator.sendBeacon("/api/t", new Blob([body], { type: "application/json" }))) return;
      fetch("/api/t", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }).catch(function () {});
    } catch (e) { /* never break the page */ }
  }
  function ev(type, name, value) {
    queue.push({ type: type, name: name == null ? "" : String(name).slice(0, 80), value: value == null ? "" : String(value).slice(0, 200), t: Date.now() });
    if (queue.length >= 25) send(false);
  }
  window.bvTrack = ev;

  ev("view", document.title);
  setTimeout(function () { send(false); }, 1500);
  setInterval(function () { send(false); }, 15000);

  /* how far down they read */
  var marks = [25, 50, 75, 100], seen = {}, ticking = false;
  function depth() {
    ticking = false;
    var h = document.documentElement, max = Math.max(1, h.scrollHeight - innerHeight), pct = Math.round(100 * (scrollY || h.scrollTop) / max);
    marks.forEach(function (m) { if (pct >= m - 2 && !seen[m]) { seen[m] = 1; ev("scroll", m); } });
  }
  addEventListener("scroll", function () { if (!ticking) { ticking = true; setTimeout(depth, 250); } }, { passive: true });

  /* what they click: links and buttons (their label, never form contents) */
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest && e.target.closest("a,button,[data-track]");
    if (!el || el.closest("form") && el.tagName === "BUTTON" && el.type !== "submit") return;
    var label = (el.getAttribute("data-track") || el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
    var href = el.tagName === "A" ? (el.getAttribute("href") || "") : "";
    ev("cta", label, href);
  }, true);

  /* forms: which field was entered, and whether it was left filled. Never the value. */
  function fieldName(el) { return (el.name || el.id || el.getAttribute("aria-label") || el.type || "field").slice(0, 60); }
  document.addEventListener("focusin", function (e) {
    var el = e.target;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== "hidden") ev("field_focus", fieldName(el));
  });
  document.addEventListener("focusout", function (e) {
    var el = e.target;
    if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.type === "hidden") return;
    var filled = el.type === "checkbox" || el.type === "radio" ? el.checked : !!(el.value && String(el.value).trim());
    ev("field_done", fieldName(el), filled ? "1" : "0");
  });

  /* leaving: how long they stayed */
  var left = false;
  function leave() { if (left) return; left = true; ev("leave", "", Date.now() - t0); send(true); }
  addEventListener("pagehide", leave);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") { send(true); } else { left = false; } });
})();
