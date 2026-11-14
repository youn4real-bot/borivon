// Borivon scenes: one clay world (nurse, resident, home), one scene per message on the page.
//   hero      the home: dark windows are empty posts; nurses walk in, the lights go on
//   problem   one beat per pain line; the Fahrplan lands at the end
//   levels    the five levels as a staircase the nurses climb
// Without WebGL or with "reduce motion" the page keeps its plain version. Source: content/pflege/fx3d.js
import * as THREE from "/pflege/assets/three.module.min.js?v=170";

const CAP = /[?&]cap=1/.test(location.search); // capture mode: time is driven from outside
const C = { clay: 0xf6f1e6, clay2: 0xe2d9c6, ink: 0x15130f, roof: 0x2a2620, gold: 0xa8843a, goldL: 0xd4b676, green: 0x6f8a6b, skin: 0xa9764d, skin2: 0xc99b78, night: 0x12110e };
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const win = (x, a, b, f = 0.05) => ss(a, a + f, x) * (1 - ss(b - f, b, x));
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.86, metalness: 0, ...o });
function mesh(geo, m, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o; }

/* ───────── a small clay person: nurse (white, gold cross) or resident (grey hair, cane) ───────── */
const PAWN = new THREE.LatheGeometry([[0, 0], [0.2, 0], [0.215, 0.04], [0.19, 0.3], [0.135, 0.56], [0.1, 0.63], [0, 0.65]].map((p) => new THREE.Vector2(p[0], p[1])), 28);
const HEAD = new THREE.SphereGeometry(0.135, 24, 18);
function person(kind) {
  const g = new THREE.Group(), nurse = kind === "nurse";
  g.add(mesh(PAWN, mat(nurse ? C.clay : 0xb9ad96)));
  g.add(mesh(HEAD, mat(nurse ? C.skin : C.skin2), 0, 0.8, 0));
  const hair = mesh(HEAD, mat(nurse ? 0x241c16 : 0xf2efe9), 0, 0.825, -0.035); hair.scale.setScalar(1.03); g.add(hair);
  if (nurse) {
    const gm = mat(C.gold, { roughness: 0.5 });
    const a = mesh(new THREE.BoxGeometry(0.11, 0.034, 0.02), gm, 0, 0.42, 0.168), b = mesh(new THREE.BoxGeometry(0.034, 0.11, 0.02), gm, 0, 0.42, 0.168);
    a.rotation.x = b.rotation.x = -0.2; g.add(a, b);
  } else {
    const cane = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.52, 8), mat(C.roof), 0.25, 0.26, 0.12); g.add(cane);
    g.add(mesh(new THREE.SphereGeometry(0.03, 10, 8), mat(C.roof), 0.25, 0.53, 0.12));
  }
  return g;
}
function wheelchair() {
  const g = new THREE.Group(), m = mat(C.roof, { roughness: 0.6 });
  g.add(mesh(new THREE.BoxGeometry(0.38, 0.04, 0.36), m, 0, 0.24, 0), mesh(new THREE.BoxGeometry(0.38, 0.36, 0.04), m, 0, 0.42, -0.19));
  for (const sx of [-1, 1]) { const w = mesh(new THREE.TorusGeometry(0.19, 0.022, 10, 28), m, sx * 0.22, 0.21, -0.04); w.rotation.y = Math.PI / 2; g.add(w); }
  const e = person("elder"); e.remove(e.children[4], e.children[3]); e.scale.set(0.9, 0.78, 0.9); e.position.y = 0.2; g.add(e);
  return g;
}

/* ───────── scene 1: the home ───────── */
function sceneHouse(root) {
  const r = rng(7);
  root.add(mesh(new THREE.CylinderGeometry(3.5, 3.5, 0.14, 72), mat(C.clay2), 0, -0.07, 0));
  const house = new THREE.Group(); root.add(house);
  house.add(mesh(new THREE.BoxGeometry(4.1, 2.25, 1.5), mat(C.clay), 0, 1.125, -0.5));
  const tri = new THREE.Shape(); tri.moveTo(-0.92, 0); tri.lineTo(0.92, 0); tri.lineTo(0, 0.8); tri.closePath();
  const roofG = new THREE.ExtrudeGeometry(tri, { depth: 4.36, bevelEnabled: false }); roofG.translate(0, 0, -2.18); roofG.rotateY(Math.PI / 2);
  house.add(mesh(roofG, mat(C.roof, { roughness: 0.7 }), 0, 2.25, -0.5));
  house.add(mesh(new THREE.BoxGeometry(0.26, 0.6, 0.26), mat(C.clay2), 1.2, 2.75, -0.7));
  house.add(mesh(new THREE.BoxGeometry(0.9, 0.82, 0.3), mat(C.clay2), 0, 0.41, 0.4));
  house.add(mesh(new THREE.BoxGeometry(1.02, 0.06, 0.42), mat(C.roof), 0, 0.85, 0.42));
  house.add(mesh(new THREE.BoxGeometry(0.36, 0.6, 0.03), mat(C.roof), 0, 0.3, 0.56));
  const wins = [], wg = new THREE.BoxGeometry(0.34, 0.42, 0.05), fg = new THREE.BoxGeometry(0.42, 0.5, 0.03);
  [0.5, 1.15, 1.8].forEach((y, fl) => {
    for (let i = 0; i < 6; i++) {
      if (fl === 0 && (i === 2 || i === 3)) continue;
      const x = -1.65 + i * 0.66;
      house.add(mesh(fg, mat(C.clay2), x, y, 0.255));
      const m = new THREE.MeshStandardMaterial({ color: 0x3a362f, roughness: 0.4, emissive: 0xff8418, emissiveIntensity: 0 });
      const w = mesh(wg, m, x, y, 0.262); w.castShadow = false; house.add(w); wins.push({ m, k: r() });
    }
  });
  wins.sort((a, b) => a.k - b.k);
  const dark = new THREE.Color(0x3a362f), lit = new THREE.Color(0xf5b45a);
  // garden
  const tree = (x, z, s) => { const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.6, 10), mat(0x6b5a45), 0, 0.3, 0)); const fm = mat(C.green);
    [[0, 0.95, 0, 0.42], [0.25, 0.75, 0.1, 0.3], [-0.24, 0.78, -0.05, 0.31], [0.02, 1.25, 0.02, 0.27]].forEach((b) => g.add(mesh(new THREE.IcosahedronGeometry(b[3], 2), fm, b[0], b[1], b[2])));
    g.position.set(x, 0, z); g.scale.setScalar(s); root.add(g); return g; };
  const trees = [tree(-2.55, 0.9, 1.15), tree(2.75, -0.3, 0.9), tree(-2.1, -1.9, 0.8)];
  for (const sx of [-1, 1]) root.add(mesh(new THREE.BoxGeometry(1.3, 0.2, 0.22), mat(C.green), sx * 1.25, 0.1, 0.62));
  root.add(mesh(new THREE.BoxGeometry(0.62, 0.012, 2.9), mat(0xd2c8b3), 0, 0.006, 1.95));
  // bench with a resident
  const bench = new THREE.Group(); bench.add(mesh(new THREE.BoxGeometry(0.8, 0.05, 0.26), mat(0x8a7558), 0, 0.2, 0), mesh(new THREE.BoxGeometry(0.8, 0.26, 0.04), mat(0x8a7558), 0, 0.36, -0.12));
  const sit = person("elder"); sit.scale.set(0.9, 0.8, 0.9); sit.position.set(-0.12, 0.12, 0.02); bench.add(sit);
  bench.position.set(-1.9, 0, 1.75); bench.rotation.y = 0.5; root.add(bench);
  const chair = wheelchair(); chair.position.set(1.95, 0, 1.7); chair.rotation.y = -0.55; root.add(chair);
  const carer = person("nurse"); carer.position.set(2.2, 0, 1.3); carer.rotation.y = -0.55; root.add(carer);
  const walkers = []; for (let i = 0; i < 7; i++) { const n = person("nurse"); n.rotation.y = Math.PI; root.add(n); walkers.push(n); }
  return {
    fit: 7.7, target: [0, 1.2, 0], radius: 14.6, height: 4.9, low: -0.63, up: 0.17,
    update(p, t) {
      const n = 3 + (wins.length - 3) * ss(0.32, 0.9, p);
      wins.forEach((w, i) => { const k = clamp(n - i); w.m.emissiveIntensity = k * (0.62 + 0.06 * Math.sin(t * 2 + i)); w.m.color.lerpColors(dark, lit, k); });
      walkers.forEach((w, i) => {
        const u = clamp((p - (0.27 + i * 0.082)) / 0.17);
        w.visible = u > 0 && u < 1; if (!w.visible) return;
        w.position.set(Math.sin(u * 5 + i) * 0.1, Math.abs(Math.sin(u * 22)) * 0.035, lerp(3.25, 0.62, u));
        w.scale.setScalar(ss(0, 0.12, u) * (1 - ss(0.9, 1, u)));
      });
      carer.scale.setScalar(ss(0.84, 0.94, p)); carer.visible = p > 0.84;
      trees.forEach((g, i) => { g.rotation.z = Math.sin(t * 0.9 + i * 2) * 0.025; });
      root.rotation.y = lerp(-0.55, 0.42, ss(0, 1, p));
    },
  };
}

/* ───────── scene 3: the five levels as a staircase ───────── */
function sceneStairs(root) {
  const names = ["Retten", "Füllen", "Halten", "Planen", "Anziehen"], W = 1.42, DX = 1.47, D = 1.7;
  const H = (i) => 0.8 + i * 0.42, X = (i) => (i - 2) * DX;
  root.add(mesh(new THREE.BoxGeometry(DX * 5 + 0.6, 0.12, D + 0.9), mat(C.clay2), 0, -0.06, 0));
  const labels = [];
  for (let i = 0; i < 5; i++) {
    const top = i === 4, h = H(i);
    root.add(mesh(new THREE.BoxGeometry(W, h, D), mat(top ? 0x1b1915 : C.clay, { roughness: top ? 0.6 : 0.86 }), X(i), h / 2, 0));
    const cv = document.createElement("canvas"); cv.width = 512; cv.height = Math.round((512 * h) / W);
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(W, h), new THREE.MeshBasicMaterial({ map: tx, transparent: true })); pl.position.set(X(i), h / 2, D / 2 + 0.002); root.add(pl);
    labels.push({ cv, tx, i, top });
  }
  const draw = () => labels.forEach(({ cv, tx, i, top }) => {
    const g = cv.getContext("2d"); g.clearRect(0, 0, cv.width, cv.height); g.textAlign = "left";
    g.fillStyle = top ? "#d4b676" : "#8a6a28"; g.font = '400 150px "EB Garamond", Georgia, serif'; g.fillText(String(i + 1), 44, 138);
    g.fillStyle = top ? "#f6f1e6" : "#15130f"; g.font = '500 66px "EB Garamond", Georgia, serif'; g.fillText(names[i], 44, cv.height - 48); tx.needsUpdate = true;
  });
  draw(); if (document.fonts && document.fonts.load) Promise.all([document.fonts.load('400 150px "EB Garamond"'), document.fonts.load('500 66px "EB Garamond"')]).then(draw);
  const chair = wheelchair(); chair.position.set(X(4) - 0.32, H(4), -0.25); chair.rotation.y = 0.5; root.add(chair);
  const nurses = []; for (let j = 0; j < 4; j++) { const n = person("nurse"); root.add(n); nurses.push(n); }
  const stepY = (k) => (k < 0 ? 0 : H(k)), stepX = (k) => (k < 0 ? X(0) - DX * 1.0 : X(k));
  return {
    fit: 9.6, target: [0, 1.3, 0], radius: 15.6, height: 4.8, low: -0.57, up: 0.07,
    update(p, t) {
      const U = ss(0.24, 0.92, p) * 6.4; this.step = Math.min(4, Math.floor(Math.min(4, U) + 0.35));
      nurses.forEach((n, j) => {
        const end = 4 - j, u = clamp(U - j * 0.8 + (j ? -1 : 0), -1, end), k = Math.min(Math.floor(u), end - 1), f = clamp(u - k);
        const e = f * f * (3 - 2 * f), on = u >= end;
        n.position.set(lerp(stepX(k), stepX(k + 1), e) + (end === 4 ? 0.34 : 0), lerp(stepY(k), stepY(k + 1), e) + Math.sin(Math.PI * f) * 0.42 + (on ? Math.abs(Math.sin(t * 2.4 + j)) * 0.02 : 0), 0.28);
        n.rotation.y = on ? 0.15 : Math.PI / 2 - 0.5; n.scale.setScalar(j ? ss(-1, -0.75, u) : 1); n.visible = j === 0 || u > -1;
      });
      root.rotation.y = lerp(-0.5, 0.3, ss(0, 1, p));
    },
  };
}

/* ───────── scene: the problem. One beat per pain line on the page (L = 0..5 lines read) ─────────
   1 nurses do not come (empty places, call lights)   2 one comes, and leaves again
   3 every empty post costs money (coins drift away)  4 the team fills in until the good ones tire
   5 nobody says what comes first -> the Fahrplan lands on the table */
function scenePain(root) {
  root.add(mesh(new THREE.CylinderGeometry(3.3, 3.3, 0.14, 72), mat(C.clay2), 0, -0.07, 0));
  const bed = () => { const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.66, 0.22, 1.3), mat(0xcfc4ad), 0, 0.11, 0), mesh(new THREE.BoxGeometry(0.6, 0.1, 1.22), mat(C.clay), 0, 0.27, 0), mesh(new THREE.BoxGeometry(0.62, 0.09, 0.78), mat(0xd9cfba), 0, 0.33, 0.2), mesh(new THREE.BoxGeometry(0.42, 0.07, 0.26), mat(0xffffff), 0, 0.345, -0.44));
    g.add(mesh(HEAD, mat(C.skin2), 0, 0.45, -0.42)); const h = mesh(HEAD, mat(0xf2efe9), 0, 0.46, -0.46); h.scale.setScalar(1.03); g.add(h); return g; };
  const ghostM = new THREE.MeshStandardMaterial({ color: 0x9a4a33, transparent: true, opacity: 0.2, depthWrite: false, roughness: 1 });
  const lightM = new THREE.MeshBasicMaterial({ color: 0xc8492a }), coinM = mat(C.gold, { roughness: 0.45 });
  const spots = [];
  [[-1.75, -1.0], [0, -1.0], [1.75, -1.0], [-1.75, 0.95], [0, 0.95], [1.75, 0.95]].forEach(([x, z], i) => {
    const res = i < 3 ? bed() : wheelchair(); res.position.set(x - 0.2, 0, z); root.add(res);
    const sx = x + 0.48, sz = z + 0.1;
    const ghost = new THREE.Group(); const gb = new THREE.Mesh(PAWN, ghostM), gh = new THREE.Mesh(HEAD, ghostM); gh.position.y = 0.8; ghost.add(gb, gh); ghost.position.set(sx, 0, sz); root.add(ghost);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.27, 0.3, 40), new THREE.MeshBasicMaterial({ color: 0x9a4a33, transparent: true, opacity: 0.55 })); ring.rotation.x = -Math.PI / 2; ring.position.set(sx, 0.005, sz); root.add(ring);
    const call = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), lightM); call.position.set(x - 0.2, i < 3 ? 0.95 : 1.25, z - (i < 3 ? 0.42 : 0)); root.add(call);
    const coin = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.028, 24), coinM); coin.castShadow = false; root.add(coin);
    spots.push({ x: sx, z: sz, ghost, ring, call, coin });
  });
  const staff = { 0: person("nurse"), 2: person("nurse"), 4: person("nurse") };
  for (const k in staff) { staff[k].position.set(spots[k].x, 0, spots[k].z); root.add(staff[k]); }
  // the Fahrplan: a real sheet with the real cover
  const sheet = new THREE.Group(); const tex = new THREE.TextureLoader().load("/pflege/assets/home/fp-cover.webp"); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  sheet.add(mesh(new THREE.BoxGeometry(1.1, 1.556, 0.02), mat(0xffffff)));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.556), new THREE.MeshBasicMaterial({ map: tex })); face.position.z = 0.012; sheet.add(face); root.add(sheet);
  return {
    fit: 6.7, target: [0, 0.6, 0], radius: 10.5, height: 4.6,
    update(L, t) {
      const gone = ss(1.05, 1.95, L), run = ss(3.05, 3.7, L), cost = ss(2.05, 2.7, L), plan = ss(4.15, 4.9, L);
      // nurse 4 came, and leaves again
      const n4 = staff[4]; n4.position.set(spots[4].x + gone * 0.4, Math.abs(Math.sin(gone * 20)) * 0.035 * (gone < 1 ? 1 : 0), lerp(spots[4].z, 3.4, gone)); n4.scale.setScalar(1 - ss(0.82, 1, gone)); n4.visible = gone < 1; n4.rotation.y = gone > 0.02 ? 0.25 : 0;
      // the two who stay fill in for everyone
      const a = staff[0], b = staff[2], w = t * 2.6;
      const ka = (Math.sin(w) + 1) / 2, kb = (Math.sin(w * 0.87 + 1.3) + 1) / 2;
      a.position.set(lerp(spots[0].x, lerp(spots[0].x, spots[1].x, ka), run), Math.abs(Math.sin(w * 3)) * 0.05 * run, lerp(spots[0].z, lerp(spots[0].z, spots[3].z, (Math.sin(w * 0.5) + 1) / 2), run));
      b.position.set(lerp(spots[2].x, lerp(spots[2].x, spots[4].x, kb), run), Math.abs(Math.sin(w * 2.6)) * 0.05 * run, lerp(spots[2].z, lerp(spots[2].z, spots[5].z, kb), run));
      a.rotation.z = Math.sin(w * 3) * 0.1 * run; b.rotation.z = Math.sin(w * 2.6) * 0.1 * run; b.rotation.x = 0.16 * run * ss(3.6, 4.2, L);
      spots.forEach((s, i) => {
        const empty = i === 1 || i === 3 || i === 5 ? ss(0.05, 0.8, L) : i === 4 ? gone : 0;
        s.ghost.visible = s.ring.visible = empty > 0.01; s.ghost.scale.setScalar(empty); s.ring.material.opacity = 0.55 * empty;
        const need = Math.max(empty, i === 0 || i === 2 ? run * 0.9 : 0), blink = 0.55 + 0.45 * Math.sin(t * 5 + i * 1.7);
        s.call.visible = need > 0.05; s.call.scale.setScalar(need * (0.7 + 0.5 * blink));
        const u = (t * 0.45 + i * 0.37) % 1; s.coin.visible = cost > 0.02 && empty > 0.5;
        s.coin.position.set(s.x + Math.sin(u * 6 + i) * 0.08, 0.95 + u * 1.5, s.z); s.coin.rotation.set(1.2, t * 3 + i, 0.3); s.coin.scale.setScalar(cost * Math.sin(Math.PI * u));
      });
      ghostM.opacity = 0.17 + 0.07 * Math.sin(t * 2.2);
      const e = plan; sheet.visible = e > 0.001; sheet.position.set(0, lerp(4.2, 1.05, 1 - Math.pow(1 - e, 3)), 2.25); sheet.rotation.set(-0.16, Math.sin(t * 0.8) * 0.12 + (1 - e) * 2.5, 0); sheet.scale.setScalar(0.4 + 0.6 * e);
      root.rotation.y = lerp(-0.5, -0.12, ss(0, 5, L));
    },
  };
}

/* ───────── scene: the Fahrplan. Three real pages open like a fan as the section comes in ───────── */
function sceneSheets(root) {
  const L = new THREE.TextureLoader(), sheets = ["fp-steps", "fp-cover", "fp-numbers"].map((n, i) => {
    const g = new THREE.Group(), tx = L.load("/pflege/assets/home/" + n + ".webp?v=2"); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
    g.add(mesh(new THREE.BoxGeometry(1.5, 2.12, 0.02), mat(0xffffff)));
    const f = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.12), new THREE.MeshBasicMaterial({ map: tx })); f.position.z = 0.012; g.add(f); root.add(g); return g; });
  const n = person("nurse"); n.position.set(1.95, 0, 0.9); n.rotation.y = -0.5; root.add(n);
  return {
    fit: 4.9, target: [0, 1.08, 0], radius: 9.4, height: 1.5,
    update(p, t) {
      const e = ss(0.05, 0.6, p);
      sheets.forEach((g, i) => { const k = i - 1; g.position.set(k * 1.12 * e, 1.08 + Math.sin(t * 1.1 + i * 1.7) * 0.03, k === 0 ? 0.25 : -0.12 * e); g.rotation.set(-0.06, -k * 0.42 * e, k * 0.02); });
      n.scale.setScalar(ss(0.3, 0.6, p)); n.visible = p > 0.3;
      root.rotation.y = lerp(-0.35, 0.18, ss(0, 1, p));
    },
  };
}

/* ───────── stages ───────── */
function makeStage(holder, build, mobile, night) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }); } catch (e) { return null; }
  holder.appendChild(renderer.domElement);
  renderer.setClearColor(0x000000, 0); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(26, 1, 0.1, 100), root = new THREE.Group(); scene.add(root);
  scene.add(night ? new THREE.HemisphereLight(0x8fa0c8, 0x1a1712, 0.5) : new THREE.HemisphereLight(0xffffff, 0xcfc4ad, 1.55));
  const sun = new THREE.DirectionalLight(night ? 0xbfcdf0 : 0xfff1dc, night ? 0.55 : 2.1); sun.position.set(5.5, 9, 6.5); sun.castShadow = true; sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048); sun.shadow.radius = 5; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 }); scene.add(sun);
  const sc = build(root, mobile);
  if (!sc.points && !night) { const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.16 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.14; floor.receiveShadow = true; scene.add(floor); }
  const st = { sc, W: 1, H: 1, dpr: 1, vis: true,
    resize() { st.W = holder.clientWidth || 1; st.H = holder.clientHeight || 1; st.dpr = Math.min(devicePixelRatio || 1, 2); renderer.setPixelRatio(st.dpr); renderer.setSize(st.W, st.H, false); cam.aspect = st.W / st.H; },
    render(p, t, ptr, zoom, offFrac) {
      sc.update(p, t, ptr, { px: ptr.px, py: ptr.py, aspect: st.W / st.H, h: st.H, dpr: st.dpr });
      root.rotation.y += ptr.x * 0.22;
      const vf = (cam.fov * Math.PI) / 360, need = sc.fit / 2 / (Math.tan(vf) * cam.aspect), R = Math.max(sc.radius, need * (cam.aspect < 0.7 ? 0.84 : 1.04)) * zoom;
      const hgt = sc.height * (R / sc.radius) + ptr.y * -0.8;
      cam.position.set(0, sc.target[1] + hgt, Math.sqrt(Math.max(1, R * R - hgt * hgt))); cam.lookAt(sc.target[0], sc.target[1], sc.target[2]);
      cam.setViewOffset(st.W, st.H, 0, Math.round(offFrac * st.H), st.W, st.H); cam.updateProjectionMatrix();
      renderer.render(scene, cam);
    } };
  new IntersectionObserver((es) => { st.vis = es[0].isIntersecting; }, { rootMargin: "100px" }).observe(holder);
  return st;
}

(function boot() {
  const hero = document.querySelector("header.hero"), stage = hero && hero.querySelector(".stage"), caps = hero && hero.querySelector(".caps3");
  if (!stage || (!CAP && matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
  const mobile = innerWidth < 700;
  // the hero: the home stands beside the headline from the first frame and plays by itself (no scrolling needed)
  const pin = document.createElement("div"); pin.className = "s3d-hero";
  const hs = makeStage(pin, sceneHouse, mobile); if (!hs) { document.documentElement.classList.remove("fx3d-on"); return; }
  const hc = hero.querySelector(".hero-c"); hc.parentNode.insertBefore(pin, hc.nextSibling);
  const beats = [].map.call(caps ? caps.children : [], (el) => { const c = document.createElement("p"); c.className = "s3d-cap"; c.setAttribute("aria-hidden", "true"); c.textContent = el.textContent; pin.appendChild(c); return c; });
  if (CAP) document.documentElement.classList.add("cap");
  hero.classList.add("fx3d");

  // the problem section: its photo becomes the scene, its five lines drive it
  const lines = [].slice.call(document.querySelectorAll("[data-line]")), fig = lines.length && lines[0].closest(".sec") && lines[0].closest(".sec").querySelector("figure.media");
  let pain = null; const psec = fig && fig.closest(".sec"); if (fig) { fig.classList.add("fx3d-box"); psec.classList.add("fx-pain"); pain = makeStage(fig, scenePain, mobile); }

  // the five levels: the cards become a staircase; the step the first nurse stands on is named below
  const s5 = document.querySelector(".steps5"), ssec = s5 && s5.closest(".sec"); let stairs = null, scap = null, sts = [], lastK = -1, sp = -1;
  if (s5) {
    const box = document.createElement("div"); box.className = "fx-steps-box"; s5.parentNode.insertBefore(box, s5);
    stairs = makeStage(box, sceneStairs, mobile);
    if (stairs) {
      scap = document.createElement("p"); scap.className = "fx-step-cap"; scap.setAttribute("aria-hidden", "true"); s5.parentNode.insertBefore(scap, s5); ssec.classList.add("fx-steps");
      sts = [].map.call(s5.querySelectorAll(".st"), (e) => [e.querySelector(".n").textContent, e.querySelector("h3").textContent, e.querySelector("p").textContent.replace(/­/g, "")]);
    } else box.remove();
  }

  // the Fahrplan section: its flat page becomes the three real pages
  const pg1 = document.querySelector("figure.page1"); let sheets = null; if (pg1) { sheets = makeStage(pg1, sceneSheets, mobile); if (sheets) pg1.classList.add("fx-sheets"); }
  // the ending: the same home, at night, every window lit
  const fin = document.querySelector(".final .c"); let night = null, nbox = null;
  if (fin) { nbox = document.createElement("div"); nbox.className = "fx-night-box"; fin.insertBefore(nbox, fin.firstChild); night = makeStage(nbox, sceneHouse, mobile, true); if (night) fin.parentNode.classList.add("fx-night"); else nbox.remove(); }
  // the platform picture leans in as it arrives, its bars fill; the three numbers count up
  const duo = document.querySelector(".duo-box"); if (duo) duo.classList.add("fx-duo");
  [].forEach.call(document.querySelectorAll(".stats b"), (b) => {
    const m = b.textContent.match(/^([0-9]+)(.*)$/); if (!m || CAP) return; const end = +m[1], suf = m[2]; b.textContent = "0" + suf;
    new IntersectionObserver((es, io) => { if (!es[0].isIntersecting) return; io.disconnect(); const t0 = performance.now();
      (function step(now) { const k = Math.min(1, (now - t0) / 1400), e = 1 - Math.pow(1 - k, 3); b.textContent = Math.round(end * e) + suf; if (k < 1) requestAnimationFrame(step); })(t0); }, { threshold: 0.6 }).observe(b);
  });
  const through = (el) => { const r = el.getBoundingClientRect(), vh = innerHeight; return clamp((vh - r.top) / (vh + r.height)); };

  function layout() { hs.resize(); if (pain) pain.resize(); if (stairs) stairs.resize(); if (sheets) sheets.resize(); if (night) night.resize(); }
  const ptr = { x: 0, y: 0, tx: 0, ty: 0, px: 9, py: 9 };
  addEventListener("pointermove", (e) => { const r = pin.getBoundingClientRect(); ptr.tx = (e.clientX / innerWidth) * 2 - 1; ptr.ty = (e.clientY / innerHeight) * 2 - 1; ptr.px = ((e.clientX - r.left) / r.width) * 2 - 1; ptr.py = -(((e.clientY - r.top) / r.height) * 2 - 1); }, { passive: true });
  addEventListener("resize", layout); layout(); setTimeout(layout, 600); if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

  let ls = -1;
  function frame(t) {
    ptr.x += (ptr.tx - ptr.x) * (CAP ? 1 : 0.06); ptr.y += (ptr.ty - ptr.y) * (CAP ? 1 : 0.06);
    if (hs.vis || CAP) {
      const p = 0.2 + 0.8 * ss(0.4, 9.5, t), bi = p < 0.46 ? 0 : p < 0.87 ? 1 : 2;
      hs.render(p, t, ptr, 0.93, 0.03);
      beats.forEach((b, i) => b.classList.toggle("on", i === bi));
    }
    if (pain && (pain.vis || CAP)) {
      const sr = psec.getBoundingClientRect(), L = clamp(-sr.top / Math.max(1, sr.height - innerHeight)) * 5.5;
      ls = ls < 0 || CAP ? L : ls + (L - ls) * 0.08;
      lines.forEach((l, i) => l.classList.toggle("fx-on", ls > i + 0.04)); psec.classList.toggle("fx-end", ls > 4.55);
      pain.render(ls, t, { x: ptr.x, y: ptr.y, px: 9, py: 9 }, 1, 0.02);
    }
    if (stairs && (stairs.vis || CAP)) {
      const r = ssec.getBoundingClientRect(), P = clamp(-r.top / Math.max(1, r.height - innerHeight)); sp = sp < 0 || CAP ? P : sp + (P - sp) * 0.1;
      stairs.render(lerp(0.22, 0.95, sp), t, { x: ptr.x, y: ptr.y, px: 9, py: 9 }, stairs.W / stairs.H > 1.7 ? 0.66 : 1, 0.04);
      const k = stairs.sc.step || 0; if (k !== lastK && sts[k]) { lastK = k; scap.textContent = ""; ["b", "span", "small"].forEach((tag, n) => { const e = document.createElement(tag); e.textContent = sts[k][n]; scap.appendChild(e); }); scap.classList.toggle("top", k === 4); }
    }
    const quiet = { x: ptr.x, y: ptr.y, px: 9, py: 9 };
    if (sheets && (sheets.vis || CAP)) sheets.render(clamp(through(pg1) * 1.7), t, quiet, 0.8, 0.03);
    if (night && (night.vis || CAP)) { quiet.x += Math.sin(t * 0.25) * 0.6; night.render(1, t, quiet, 0.82, 0.06); }
    if (duo) { const k = 1 - clamp(through(duo) * 2.1); duo.style.setProperty("--k", k.toFixed(3)); if (k < 0.45) duo.classList.add("in2"); }
  }
  window.__fx = { frame, layout };
  if (CAP) { frame(0); return; }
  const t0 = performance.now(); (function loop(now) { requestAnimationFrame(loop); if (!document.hidden) frame((now - t0) / 1000); })(t0);
})();
