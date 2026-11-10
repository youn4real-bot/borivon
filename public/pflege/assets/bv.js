/* Borivon public pages: FAQ, gliding anchor links, quiet motion. Built to public/pflege/assets/bv.js
   by scripts/build-pflege.mjs. Headlines rise word by word, photos open from below, lists light up while
   you read, a slow drift on big photos (desktop only), the bar hides while you read down, a phone button
   stays in reach. Everything is visible without JS and with "reduce motion". */
(function () {
  var d = document, w = window;
  var reduce = w.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  w.__bvMotion = 1;

  /* FAQ: a click folds an answer away (or back open) */
  [].forEach.call(d.querySelectorAll(".qh"), function (b) {
    b.addEventListener("click", function () {
      var o = b.parentElement.classList.toggle("open");
      b.setAttribute("aria-expanded", o ? "true" : "false");
    });
  });

  /* "#" links glide instead of jumping; on a phone, #termin aims at the calendar itself */
  (function () {
    var run = 0;
    function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function glide(y) {
      var y0 = w.scrollY, dy = y - y0, id = ++run;
      if (Math.abs(dy) < 2) return;
      if (reduce) { w.scrollTo(0, y); return; }
      var dur = Math.min(1200, 520 + Math.abs(dy) * .1), t0 = performance.now();
      function stop() { run++; }
      w.addEventListener("wheel", stop, { passive: true, once: true });
      w.addEventListener("touchstart", stop, { passive: true, once: true });
      (function step(now) {
        if (id !== run) return;
        var p = Math.min(1, (now - t0) / dur);
        w.scrollTo(0, y0 + dy * ease(p));
        if (p < 1) requestAnimationFrame(step);
      })(t0);
    }
    d.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]'); if (!a) return;
      var id = a.getAttribute("href").slice(1), el = id && d.getElementById(id); if (!el) return;
      e.preventDefault();
      var t = (id === "termin" && w.innerWidth <= 900 && d.querySelector(".calcol")) || el;
      glide(t.getBoundingClientRect().top + w.scrollY - 16);
      if (history.replaceState) history.replaceState(null, "", "#" + id);
    });
  })();

  /* headlines: one span per word (text stays text for screen readers and search);
     never split at a no-break space, so "2 Tagen" stays together */
  [].forEach.call(d.querySelectorAll("[data-split]"), function (el) {
    var i = 0;
    (function walk(n) {
      [].slice.call(n.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var frag = d.createDocumentFragment();
          c.textContent.split(/([ \t\r\n]+)/).forEach(function (p) {
            if (!p) return;
            if (/^[ \t\r\n]+$/.test(p)) { frag.appendChild(d.createTextNode(p)); return; }
            var o = d.createElement("span"), s = d.createElement("span");
            o.className = "wd"; s.textContent = p; s.style.setProperty("--i", i++);
            o.appendChild(s); frag.appendChild(o);
          });
          n.replaceChild(frag, c);
        } else if (c.nodeType === 1 && c.tagName !== "BR") walk(c);
      });
    })(el);
  });

  /* a group fades in one after another */
  [].forEach.call(d.querySelectorAll("[data-r]"), function (e) {
    var k = 0;
    [].some.call(e.parentElement.children, function (c) { if (c === e) return true; if (c.hasAttribute("data-r")) k++; });
    e.style.setProperty("--d", Math.min(k, 6));
  });
  var els = d.querySelectorAll("[data-r],[data-split],[data-m]");
  var io = null, pending = [];
  if (reduce || !("IntersectionObserver" in w)) [].forEach.call(els, function (e) { e.classList.add("in"); });
  else {
    io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -7% 0px", threshold: .1 });
    [].forEach.call(els, function (e) { io.observe(e); });
    pending = [].slice.call(els);
  }
  /* safety net: a fast fling can carry a small element past the screen between two frames, and the
     observer never sees it. Anything already reached or passed is revealed on the next frame. */
  var armed = false; // not on the first frames: the observer opens the first screen with its animation
  setTimeout(function () { armed = true; onScroll(); }, 1200);
  function sweep(vh) {
    if (!armed || !pending.length) return;
    pending = pending.filter(function (e) {
      if (e.classList.contains("in")) return false;
      if (e.getBoundingClientRect().top < vh * .93) { e.classList.add("in"); if (io) io.unobserve(e); return false; }
      return true;
    });
  }

  var lines = [].slice.call(d.querySelectorAll("[data-line]"));
  var pxs = [].slice.call(d.querySelectorAll("[data-px]"));
  var desk = w.matchMedia("(min-width: 901px) and (pointer: fine)");
  var nav = d.querySelector(".nav"), mcta = d.querySelector(".mcta"), heroBtn = d.querySelector(".hero .btn");
  var hideZones = [].slice.call(d.querySelectorAll("[data-mcta-hide],.final,.foot"));
  var lastY = w.scrollY, ticking = false;
  function frame() {
    ticking = false;
    var vh = w.innerHeight, y = w.scrollY;
    sweep(vh);
    if (!reduce) lines.forEach(function (l) { var r = l.getBoundingClientRect(); l.classList.toggle("on", r.top + r.height / 2 < vh * .66); });
    if (!reduce && desk.matches) pxs.forEach(function (img) {
      var r = img.parentElement.getBoundingClientRect(); if (r.bottom < -50 || r.top > vh + 50) return;
      var p = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2);
      img.style.transform = "translate3d(0," + (p * -5).toFixed(2) + "%,0) scale(1.11)";
    });
    if (nav) {
      nav.classList.toggle("solid", y > 8);
      if (y > lastY + 6 && y > 260) nav.classList.add("hide"); else if (y < lastY - 6) nav.classList.remove("hide");
    }
    lastY = y;
    if (mcta && heroBtn) {
      var hb = heroBtn.getBoundingClientRect();
      var inZone = hideZones.some(function (z) { var r = z.getBoundingClientRect(); return r.top < vh && r.bottom > 0; });
      mcta.classList.toggle("show", hb.bottom < 0 && !inZone && !d.getElementById("bv-consent"));
    }
  }
  function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
  w.addEventListener("scroll", onScroll, { passive: true });
  w.addEventListener("resize", onScroll);
  if (desk.addEventListener) desk.addEventListener("change", function () { pxs.forEach(function (i) { i.style.transform = ""; }); onScroll(); });
  onScroll();
})();
