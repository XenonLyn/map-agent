// ===================== CORE: generation, verification, tools =====================
const N = 512, NN = N * N, SC = N / 256;
const KM_PER_CELL = 2, KM_PER_DAY = 32;
const MOUNTAIN_REL = 0.36;      // elevation above sea level that counts as mountain
const SLOPE_MAX = 0.016;        // settlements need flatter ground than this
const LAKE_DEPTH = 0.024, LAKE_MIN = 160;
const MAJOR_LEN = 60;           // cells of main stem for a "major" river
const MOUNTAIN_MIN_CELLS = 1400;
const REGIONS = ["NW", "N", "NE", "W", "C", "E", "SW", "S", "SE"];
const REGION_ZH = { NW: "西北", N: "北", NE: "东北", W: "西", C: "中", E: "东", SW: "西南", S: "南", SE: "东南" };
const TYPE_ZH = { port: "港口", city: "城市", town: "城镇", village: "村庄", fortress: "要塞" };
const REQ_ZH = { coast: "临海", river_mouth: "位于河口", on_river: "临河", lakeside: "临湖", near_mountain: "靠近山脉" };
const BIOME_ZH = { ocean: "海洋", lake: "湖泊", snow: "雪峰", rock: "裸岩山地", tundra: "苔原", taiga: "针叶林", steppe: "干草原", desert: "荒漠", grassland: "草地", forest: "温带森林", marsh: "沼泽", rainforest: "温带雨林" };
const RIVER_NAMES = ["灰水河", "柳溪", "黑石河", "银带河", "雾川", "赤泥河", "鹭河", "冷泉河", "白沙河", "枯苇河", "长汀", "鸣石溪"];
const LAKE_NAMES = ["镜湖", "沉钟湖", "苇塘", "寒潭", "月牙泊", "灰眼湖", "无底潭", "鹤汀湖"];
const DIRS8 = ["东", "东南", "南", "西南", "西", "西北", "北", "东北"];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function clampInt(v, a, b, d) { v = Math.round(+v); return Number.isFinite(v) ? clamp(v, a, b) : d; }
function regionOf(x, y) { const cx = Math.min(2, Math.floor(x / (N / 3))), cy = Math.min(2, Math.floor(y / (N / 3))); return REGIONS[cy * 3 + cx]; }
function regionCenter(r) { const i = REGIONS.indexOf(r); return [((i % 3) + 0.5) * N / 3, (Math.floor(i / 3) + 0.5) * N / 3]; }
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const deep = o => JSON.parse(JSON.stringify(o));
const DX8 = [-1, 0, 1, -1, 1, -1, 0, 1], DY8 = [-1, -1, -1, 0, 0, 1, 1, 1], DD8 = [1.414, 1, 1.414, 1, 1, 1.414, 1, 1.414];

function makePerlin(seed) {
  const r = rng(seed), perm = [...Array(256).keys()], p = new Uint8Array(512);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1.41, 0], [-1.41, 0], [0, 1.41], [0, -1.41]];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xf = Math.floor(x), yf = Math.floor(y), X = xf & 255, Y = yf & 255; x -= xf; y -= yf;
    const g = (hh, dx, dy) => { const q = G[hh & 7]; return q[0] * dx + q[1] * dy; };
    const u = fade(x), v = fade(y);
    const n00 = g(p[p[X] + Y], x, y), n10 = g(p[p[X + 1] + Y], x - 1, y);
    const n01 = g(p[p[X] + Y + 1], x, y - 1), n11 = g(p[p[X + 1] + Y + 1], x - 1, y - 1);
    const a = n00 + u * (n10 - n00), b = n01 + u * (n11 - n01);
    return a + v * (b - a);
  };
}
function fbm(nz, x, y, oct) { let s = 0, a = 0.5, f = 1, norm = 0; for (let i = 0; i < oct; i++) { s += a * nz(x * f, y * f); norm += a; a *= 0.5; f *= 2.03; } return s / norm; }

// ---------- WorldSpec ----------
function normalizeSpec(raw) {
  const s = raw && typeof raw === "object" ? deep(raw) : {};
  const out = {};
  out.name = String(s.name || "未命名区域").slice(0, 40);
  out.seed = Number.isFinite(+s.seed) ? (Math.abs(+s.seed | 0) % 100000) : hashStr(out.name) % 100000;
  out.ocean_side = ["E", "W", "N", "S", "all", "none"].includes(s.ocean_side) ? s.ocean_side : "E";
  out.wind_from = ["E", "W", "N", "S"].includes(s.wind_from) ? s.wind_from : "W";
  out.mountains = (Array.isArray(s.mountains) ? s.mountains : []).slice(0, 6).map((m, i) => ({
    id: "M" + (i + 1), name: String(m.name || "无名山脉").slice(0, 20),
    region: REGIONS.includes(m.region) ? m.region : "N",
    orientation: m.orientation === "NS" ? "NS" : "EW",
  }));
  out.min_major_rivers = clampInt(s.min_major_rivers, 0, 6, 1);
  out.min_lakes = clampInt(s.min_lakes, 0, 4, 0);
  const REQ = Object.keys(REQ_ZH);
  out.settlements = (Array.isArray(s.settlements) ? s.settlements : []).slice(0, 12).map((t, i) => {
    const type = TYPE_ZH[t.type] ? t.type : "town";
    let req = (Array.isArray(t.requires) ? t.requires : []).filter(r => REQ.includes(r));
    if (type === "port" && !req.includes("coast")) req.unshift("coast");
    if (req.includes("river_mouth") && !req.includes("coast")) req.unshift("coast");
    return { id: "S" + (i + 1), name: String(t.name || ("聚落" + (i + 1))).slice(0, 20), type, region: REGIONS.includes(t.region) ? t.region : null, requires: [...new Set(req)] };
  });
  return out;
}
function initParams(spec) {
  return {
    seed: spec.seed, sea: 0.40, hydro: "naive", climate: "noise", riverThr: 260,
    ridges: spec.mountains.map((m, k) => ({ mid: m.id, region: m.region, orientation: m.orientation, amp: 0.14, k })),
    basins: [], unsat: [], pos: null,
  };
}

// ---------- terrain ----------
function landShape(side, u, v, n) {
  const w = n * 0.10;
  // land tilts down towards the sea so the main rivers drain into it
  switch (side) {
    case "E": return 0.02 + 0.16 * (1 - u) - 0.62 * smooth(0.70, 0.98, u + w);
    case "W": return 0.02 + 0.16 * u - 0.62 * smooth(0.70, 0.98, 1 - u + w);
    case "N": return 0.02 + 0.16 * v - 0.62 * smooth(0.70, 0.98, 1 - v + w);
    case "S": return 0.02 + 0.16 * (1 - v) - 0.62 * smooth(0.70, 0.98, v + w);
    case "all": { const d = Math.hypot(u - 0.5, v - 0.5) * 2; return 0.03 + 0.16 * (1 - d) - 0.62 * smooth(0.62, 0.98, d + w); }
    default: return 0.13;
  }
}
function applyRidge(h, r, nz) {
  const [cx, cy] = regionCenter(r.region), half = N / 3 * 0.66, sig = N * 0.024;
  const ew = r.orientation !== "NS";
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const along = ew ? x - cx : y - cy, across = ew ? y - cy : x - cx;
    if (Math.abs(along) > half * 1.35) continue;
    const wig = nz(along * 0.018 / SC + 11 * (r.k + 1), 7.7) * N * 0.045 + 0.4 * nz(along * 0.05 + 3 * r.k, 1.1) * sig;
    const d = across - wig;
    if (Math.abs(d) > sig * 4) continue;
    const taper = 1 - smooth(half * 0.75, half * 1.35, Math.abs(along));
    const g = Math.exp(-d * d / (2 * sig * sig));
    const peaks = 0.5 + 0.5 * Math.abs(nz(x * 0.045 + 3, y * 0.045 + 5)) * 2.2 + 0.25 * Math.abs(nz(x * 0.12 + 9, y * 0.12 + 1));
    // side spurs: a wider, ridged-noise shoulder so the range branches instead of forming a smooth wall
    const rg = 1 - Math.abs(nz(x * 0.028 + 17, y * 0.028 + 4)); const spur = Math.exp(-d * d / (2 * (sig * 2.6) ** 2)) * rg * rg * rg;
    h[y * N + x] += r.amp * taper * (g * Math.min(1.25, peaks) + 0.55 * spur);
  }
}
function applyBasin(h, b, sea) {
  if (b.cx == null) {
    const [cx, cy] = regionCenter(b.region); let best = -1, bs = -1e9;
    for (let y = Math.floor(cy - N / 6) + 24; y < cy + N / 6 - 24; y++) for (let x = Math.floor(cx - N / 6) + 24; x < cx + N / 6 - 24; x++) {
      const e = h[y * N + x]; if (e < sea + 0.08 || e > sea + MOUNTAIN_REL - 0.05) continue;
      const s = -Math.hypot(x - cx, y - cy) * 0.004 - Math.abs(e - sea - 0.16);
      if (s > bs) { bs = s; best = y * N + x; }
    }
    if (best < 0) best = Math.floor(cy) * N + Math.floor(cx);
    b.cx = best % N; b.cy = Math.floor(best / N);
  }
  const R = 22;
  for (let y = Math.max(0, b.cy - R * 2); y < Math.min(N, b.cy + R * 2); y++) for (let x = Math.max(0, b.cx - R * 2); x < Math.min(N, b.cx + R * 2); x++) {
    const d = Math.hypot(x - b.cx, y - b.cy); h[y * N + x] -= b.depth * Math.exp(-d * d / (2 * (R / 1.6) ** 2));
  }
}
function thermal(h, iters) {
  const T = 0.010, k = 0.25, delta = new Float32Array(NN);
  for (let it = 0; it < iters; it++) {
    delta.fill(0);
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const i = y * N + x; let md = 0, j = -1;
      for (const nb of [i - 1, i + 1, i - N, i + N]) { const d = h[i] - h[nb]; if (d > md) { md = d; j = nb; } }
      if (md > T) { const m = k * (md - T) / 2; delta[i] -= m; delta[j] += m; }
    }
    for (let i = 0; i < NN; i++) h[i] += delta[i];
  }
}
function boxBlurCore(src, r) {
  const t = new Float32Array(NN), o = new Float32Array(NN);
  for (let y = 0; y < N; y++) { let acc = 0, c = 0; for (let x = -r; x < N + r; x++) { const a = x + r, b = x - r - 1; if (a >= 0 && a < N) { acc += src[y * N + a]; c++; } if (b >= 0 && b < N) { acc -= src[y * N + b]; c--; } if (x >= 0 && x < N) t[y * N + x] = acc / c; } }
  for (let x = 0; x < N; x++) { let acc = 0, c = 0; for (let y = -r; y < N + r; y++) { const a = y + r, b = y - r - 1; if (a >= 0 && a < N) { acc += t[a * N + x]; c++; } if (b >= 0 && b < N) { acc -= t[b * N + x]; c--; } if (y >= 0 && y < N) o[y * N + x] = acc / c; } }
  return o;
}
// cut dendritic valleys along the drainage network (a cheap stand-in for fluvial erosion)
function carveValleys(h, sea) {
  const ocean = oceanMask(h, sea), surf = priorityFlood(h, ocean);
  const idx = []; for (let i = 0; i < NN; i++) if (!ocean[i]) idx.push(i);
  const order = Int32Array.from(idx); order.sort((a, b) => surf[b] - surf[a]);
  const acc = new Float32Array(NN).fill(1), down = new Int32Array(NN).fill(-1);
  for (const i of order) {
    const x = i % N, y = (i - x) / N; let best = -1, bs = 0;
    for (let k = 0; k < 8; k++) { const xx = x + DX8[k], yy = y + DY8[k]; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; const nb = yy * N + xx, sl = (surf[i] - surf[nb]) / DD8[k]; if (sl > bs) { bs = sl; best = nb; } }
    down[i] = best; if (best >= 0) acc[best] += acc[i];
  }
  const carve = new Float32Array(NN);
  const L0 = Math.log(3 * SC * SC), L1 = Math.log(9000 * SC * SC);
  for (const i of order) { const t = smooth(L0, L1, Math.log(acc[i])); carve[i] = Math.sqrt(t); }
  const wide = boxBlurCore(carve, Math.round(3 * SC)), narrow = boxBlurCore(carve, 1);
  for (const i of order) {
    const rel = h[i] - sea;
    const depth = 0.028 + 0.05 * smooth(0.05, 0.35, rel);    // deeper gorges in the uplands
    h[i] -= depth * (0.45 * narrow[i] + 0.9 * wide[i]);
  }
}
function buildTerrain(spec, P) {
  const nz = makePerlin(P.seed), nz2 = makePerlin(P.seed * 7 + 13), nz3 = makePerlin(P.seed * 3 + 101);
  const h = new Float32Array(NN);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const wx = u + 0.07 * nz2(u * 2 + 5.2, v * 2 + 1.3) + 0.015 * nz3(u * 9, v * 9), wy = v + 0.07 * nz2(u * 2 + 9.7, v * 2 + 3.1) + 0.015 * nz3(u * 9 + 50, v * 9 + 50);
    const base = fbm(nz, wx * 4.6, wy * 4.6, 7);
    // ridged multifractal hills where the base terrain is already high
    let rid = 0, amp = 0.5, f = 6.5;
    for (let o = 0; o < 4; o++) { const r = 1 - Math.abs(nz3(wx * f + o * 13, wy * f + o * 7)); rid += amp * r * r; amp *= 0.5; f *= 2.1; }
    const upl = smooth(0.0, 0.32, base + 0.1 * nz2(u * 3 + 60, v * 3));
    const coastN = nz2(u * 4 + 20, v * 4 + 20) + 0.45 * nz3(u * 12 + 3, v * 12 + 9) + 0.2 * nz3(u * 30 + 7, v * 30 + 1);
    h[y * N + x] = 0.5 + 0.22 * base + 0.08 * upl * (rid - 0.45) + 0.05 * fbm(nz2, u * 1.3 + 40, v * 1.3 + 40, 2) + landShape(spec.ocean_side, u, v, coastN);
  }
  P.ridges.forEach(r => applyRidge(h, r, nz2));
  carveValleys(h, P.sea);
  P.basins.forEach(b => applyBasin(h, b, P.sea));
  thermal(h, 3);
  return h;
}

// ---------- climate ----------
function oceanMask(h, sea) {
  const o = new Uint8Array(NN), q = new Int32Array(NN); let qt = 0, qh = 0;
  for (let i = 0; i < N; i++) for (const c of [i, (N - 1) * N + i, i * N, i * N + N - 1]) if (h[c] < sea && !o[c]) { o[c] = 1; q[qt++] = c; }
  while (qh < qt) {
    const c = q[qh++], x = c % N;
    const nbs = [x > 0 ? c - 1 : -1, x < N - 1 ? c + 1 : -1, c - N, c + N];
    for (const nb of nbs) if (nb >= 0 && nb < NN && !o[nb] && h[nb] < sea) { o[nb] = 1; q[qt++] = nb; }
  }
  return o;
}
function buildMoisture(spec, P, h, ocean) {
  const m = new Float32Array(NN);
  const nz = makePerlin(P.seed + 77);
  if (P.climate === "noise") {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) m[y * N + x] = clamp(0.48 + 0.9 * fbm(nz, x / N * 2.6, y / N * 2.6, 4), 0.05, 0.95);
    return m;
  }
  const w = spec.wind_from;
  const lines = N, steps = N;
  for (let l = 0; l < lines; l++) {
    let vap = 1.0, prev = null;
    for (let s = 0; s < steps; s++) {
      let x, y;
      if (w === "W") { x = s; y = l; } else if (w === "E") { x = N - 1 - s; y = l; } else if (w === "N") { x = l; y = s; } else { x = l; y = N - 1 - s; }
      const i = y * N + x;
      if (ocean[i]) { vap = Math.min(1, vap + 0.06 / SC); m[i] = 0.6; prev = h[i]; continue; }
      const e = h[i], dh = prev == null ? 0 : Math.max(0, e - prev);
      const rain = Math.min(vap, vap * (0.010 / SC + dh * 7));
      vap = Math.min(1, vap - rain + 0.004 / SC);
      m[i] = rain * 34 * SC;
      prev = e;
    }
  }
  // blur along both axes to smooth streaks, add a little noise
  const t = new Float32Array(NN);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0, c = 0;
      for (let d = -5; d <= 5; d++) { const xx = pass ? x : x + d, yy = pass ? y + d : y; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; s += m[yy * N + xx]; c++; }
      t[y * N + x] = s / c;
    }
    m.set(t);
  }
  // sea breeze: coasts stay humid even in the lee of a range
  const dO = distField(i => ocean[i]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = y * N + x; m[i] = clamp(m[i] + 0.32 * Math.exp(-dO[i] / (26 * SC)) + 0.12 * fbm(nz, x / N * 3, y / N * 3, 3), 0.03, 0.97); }
  return m;
}

// ---------- hydrology ----------
class Heap {
  constructor(cap) { this.i = new Int32Array(cap); this.k = new Float32Array(cap); this.n = 0; this.key = 0; }
  grow() { const i = new Int32Array(this.i.length * 2), k = new Float32Array(this.k.length * 2); i.set(this.i); k.set(this.k); this.i = i; this.k = k; }
  push(idx, key) { if (this.n >= this.i.length) this.grow(); let c = this.n++; while (c > 0) { const p = (c - 1) >> 1; if (this.k[p] <= key) break; this.i[c] = this.i[p]; this.k[c] = this.k[p]; c = p; } this.i[c] = idx; this.k[c] = key; }
  pop() {
    const top = this.i[0]; this.key = this.k[0]; const li = this.i[--this.n], lk = this.k[this.n]; let c = 0;
    while (true) { let ch = 2 * c + 1; if (ch >= this.n) break; if (ch + 1 < this.n && this.k[ch + 1] < this.k[ch]) ch++; if (this.k[ch] >= lk) break; this.i[c] = this.i[ch]; this.k[c] = this.k[ch]; c = ch; }
    this.i[c] = li; this.k[c] = lk; return top;
  }
}
const SHARED_HEAP = new Heap(1 << 20);
function nbrs8(i) {
  const x = i % N, y = (i - x) / N, out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue; const xx = x + dx, yy = y + dy;
    if (xx >= 0 && yy >= 0 && xx < N && yy < N) out.push(yy * N + xx);
  }
  return out;
}
const isBorder = i => { const x = i % N, y = (i - x) / N; return x === 0 || y === 0 || x === N - 1 || y === N - 1; };
function priorityFlood(h, ocean) {
  const surf = Float32Array.from(h), closed = new Uint8Array(NN), heap = SHARED_HEAP; heap.n = 0;
  for (let i = 0; i < NN; i++) if (ocean[i] || isBorder(i)) { closed[i] = 1; heap.push(i, surf[i]); }
  while (heap.n) {
    const c = heap.pop(), x = c % N, y = (c - x) / N, sc = surf[c];
    for (let k = 0; k < 8; k++) {
      const xx = x + DX8[k], yy = y + DY8[k]; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      const nb = yy * N + xx; if (closed[nb]) continue; closed[nb] = 1;
      if (surf[nb] <= sc + 1e-5) surf[nb] = sc + 1e-5;
      heap.push(nb, surf[nb]);
    }
  }
  return surf;
}
function buildHydro(P, h, moist, ocean) {
  const surf = P.hydro === "filled" ? priorityFlood(h, ocean) : Float32Array.from(h);
  const down = new Int32Array(NN).fill(-1);
  const land = [];
  for (let i = 0; i < NN; i++) {
    if (ocean[i]) continue; land.push(i);
    let best = -1, bs = 0; const x = i % N, y = (i - x) / N;
    for (let k = 0; k < 8; k++) {
      const xx = x + DX8[k], yy = y + DY8[k]; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      const nb = yy * N + xx, s = (surf[i] - surf[nb]) / DD8[k]; if (s > bs) { bs = s; best = nb; }
    }
    down[i] = best >= 0 ? best : (isBorder(i) ? -1 : -2);
  }
  { // sort land cells by surface, highest first (packed float keys: much faster than a comparator sort)
    const keys = new Float64Array(land.length); for (let k = 0; k < land.length; k++) keys[k] = Math.floor(-surf[land[k]] * 1e7) * 1048576 + land[k];
    keys.sort(); for (let k = 0; k < land.length; k++) { const v = keys[k]; land[k] = v - Math.floor(v / 1048576) * 1048576; } }
  const acc = new Float32Array(NN);
  for (const i of land) acc[i] += 0.3 + moist[i];
  for (const i of land) { const d = down[i]; if (d >= 0 && !ocean[d]) acc[d] += acc[i]; }
  // lakes
  const lake = new Uint8Array(NN), lakes = [];
  if (P.hydro === "filled") {
    const cand = new Uint8Array(NN);
    for (const i of land) if (surf[i] - h[i] > LAKE_DEPTH) cand[i] = 1;
    const seen = new Uint8Array(NN);
    for (const i of land) {
      if (!cand[i] || seen[i]) continue;
      const comp = [i]; seen[i] = 1;
      for (let q = 0; q < comp.length; q++) { const c = comp[q], x = c % N, y = (c - x) / N; for (let k = 0; k < 8; k++) { const xx = x + DX8[k], yy = y + DY8[k]; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; const nb = yy * N + xx; if (cand[nb] && !seen[nb]) { seen[nb] = 1; comp.push(nb); } } }
      if (comp.length >= LAKE_MIN) {
        let sx = 0, sy = 0; for (const c of comp) { lake[c] = 1; sx += c % N; sy += Math.floor(c / N); }
        lakes.push({ cells: comp.length, cx: sx / comp.length, cy: sy / comp.length });
      }
    }
    lakes.sort((a, b) => b.cells - a.cells);
    lakes.forEach((l, k) => { l.id = "L" + (k + 1); l.name = LAKE_NAMES[k % LAKE_NAMES.length]; l.region = regionOf(l.cx, l.cy); });
  }
  const channel = new Uint8Array(NN), len = new Float32Array(NN);
  for (const i of land) if (acc[i] >= P.riverThr) channel[i] = 1;
  for (const i of land) {
    if (!channel[i]) continue; if (len[i] < 1) len[i] = 1;
    const d = down[i]; if (d >= 0 && channel[d]) len[d] = Math.max(len[d], len[i] + 1);
  }
  const mouths = [], sinks = [];
  for (const i of land) {
    if (!channel[i]) continue; const d = down[i];
    if (d === -2) sinks.push({ i, acc: acc[i] });
    else if (d === -1 || ocean[d]) mouths.push({ i, len: len[i], acc: acc[i], kind: d === -1 ? "edge" : "sea" });
  }
  sinks.sort((a, b) => b.acc - a.acc);
  mouths.sort((a, b) => b.acc - a.acc);
  const sys = new Int32Array(NN).fill(-1);
  const mouthIdx = new Map(); mouths.forEach((m, k) => mouthIdx.set(m.i, k));
  for (let k = land.length - 1; k >= 0; k--) {
    const i = land[k]; if (!channel[i]) continue;
    if (mouthIdx.has(i)) { sys[i] = mouthIdx.get(i); continue; }
    const d = down[i]; if (d >= 0 && channel[d]) sys[i] = sys[d];
  }
  const rivers = []; const riverOfSys = new Map();
  mouths.forEach((m, k) => {
    if (m.len < MAJOR_LEN) return;
    const r = { id: "R" + (rivers.length + 1), name: RIVER_NAMES[rivers.length % RIVER_NAMES.length], mouth: m.i, kind: m.kind, lengthKm: Math.round(m.len * KM_PER_CELL * 1.2), mouthRegion: regionOf(m.i % N, Math.floor(m.i / N)) };
    rivers.push(r); riverOfSys.set(k, r);
  });
  // regions each river passes
  const regs = new Map();
  for (const i of land) if (channel[i] && sys[i] >= 0 && riverOfSys.has(sys[i]) && !lake[i]) {
    const r = riverOfSys.get(sys[i]); if (!regs.has(r.id)) regs.set(r.id, new Set()); regs.get(r.id).add(regionOf(i % N, Math.floor(i / N)));
  }
  rivers.forEach(r => r.regions = [...(regs.get(r.id) || [])]);
  return { surf, down, acc, lake, lakes, channel, sys, mouths, sinks, rivers, riverOfSys, land };
}

// ---------- distance fields ----------
function distField(mask) {
  const d = new Float32Array(NN), INF = 1e9, D = 1.4142;
  for (let i = 0; i < NN; i++) d[i] = mask(i) ? 0 : INF;
  for (let y = 0; y < N; y++) {
    const row = y * N;
    for (let x = 0; x < N; x++) {
      const i = row + x; let v = d[i];
      if (v === 0) continue;
      if (x > 0) { const t = d[i - 1] + 1; if (t < v) v = t; }
      if (y > 0) {
        let t = d[i - N] + 1; if (t < v) v = t;
        if (x > 0) { t = d[i - N - 1] + D; if (t < v) v = t; }
        if (x < N - 1) { t = d[i - N + 1] + D; if (t < v) v = t; }
      }
      d[i] = v;
    }
  }
  for (let y = N - 1; y >= 0; y--) {
    const row = y * N;
    for (let x = N - 1; x >= 0; x--) {
      const i = row + x; let v = d[i];
      if (v === 0) continue;
      if (x < N - 1) { const t = d[i + 1] + 1; if (t < v) v = t; }
      if (y < N - 1) {
        let t = d[i + N] + 1; if (t < v) v = t;
        if (x < N - 1) { t = d[i + N + 1] + D; if (t < v) v = t; }
        if (x > 0) { t = d[i + N - 1] + D; if (t < v) v = t; }
      }
      d[i] = v;
    }
  }
  return d;
}

// ---------- biomes ----------
function biomeOf(e, sea, m, v) {
  const rel = e - sea;
  const temp = 0.40 + 0.40 * v - rel * 1.1;
  if (rel > MOUNTAIN_REL + 0.06) return temp < 0.12 ? "snow" : "rock";
  if (temp < 0.10) return "tundra";
  if (temp < 0.22) return m > 0.40 ? "taiga" : "tundra";
  if (m < 0.16) return "desert";
  if (m < 0.30) return "steppe";
  if (m < 0.46) return "grassland";
  if (rel < 0.08 && m > 0.62) return "marsh";
  if (m < 0.68) return "forest";
  return "rainforest";
}

// ---------- derive a whole world ----------
function derive(spec, P) {
  P = deep(P);
  const h = buildTerrain(spec, P);
  const ocean = oceanMask(h, P.sea);
  const moist = buildMoisture(spec, P, h, ocean);
  const hy = buildHydro(P, h, moist, ocean);
  const biome = new Array(NN);
  for (let i = 0; i < NN; i++) biome[i] = ocean[i] ? "ocean" : hy.lake[i] ? "lake" : biomeOf(h[i], P.sea, moist[i], Math.floor(i / N) / N);
  const riverCell = i => hy.channel[i] && !hy.lake[i];
  const seaMouths = new Uint8Array(NN); hy.rivers.forEach(r => { if (r.kind === "sea") seaMouths[r.mouth] = 1; });
  const W = {
    spec, P, h, ocean, moist, hy, biome,
    dOcean: distField(i => ocean[i]),
    dRiver: distField(riverCell),
    dLake: distField(i => hy.lake[i]),
    dMount: distField(i => !ocean[i] && h[i] - P.sea > MOUNTAIN_REL),
    dMouth: distField(i => seaMouths[i]),
    travel: new Map(),
  };
  if (!W.P.pos) placeInitial(W);
  return W;
}
const cellXY = i => [i % N, Math.floor(i / N)];
function slopeAt(W, i) {
  const x = i % N, h = W.h; let m = 0;
  for (const nb of [x > 0 ? i - 1 : i, x < N - 1 ? i + 1 : i, i >= N ? i - N : i, i < NN - N ? i + N : i]) m = Math.max(m, Math.abs(h[i] - h[nb]));
  return m;
}
const isDry = (W, i) => !W.ocean[i] && !W.hy.lake[i];
const REQ_TEST = {
  coast: (W, i) => W.dOcean[i] <= 1.5,
  river_mouth: (W, i) => W.dMouth[i] <= 4.5,
  on_river: (W, i) => W.dRiver[i] <= 1.5,
  lakeside: (W, i) => W.dLake[i] <= 2.5,
  near_mountain: (W, i) => W.dMount[i] <= 14 && W.h[i] - W.P.sea < MOUNTAIN_REL - 0.04,
};
function placeInitial(W) {
  const r = rng(W.P.seed + 999); W.P.pos = {};
  const taken = [];
  for (const s of W.spec.settlements) {
    let best = -1, bs = -1e9;
    const [cx, cy] = s.region ? regionCenter(s.region) : [N / 2, N / 2];
    const span = s.region ? N / 3 : N;
    for (let k = 0; k < 900; k++) {
      const x = Math.floor(cx - span / 2 + r() * span), y = Math.floor(cy - span / 2 + r() * span);
      if (x < 2 || y < 2 || x > N - 3 || y > N - 3) continue;
      const i = y * N + x; if (!isDry(W, i)) continue;
      if (taken.some(t => Math.hypot(t[0] - x, t[1] - y) < 28)) continue;
      const sc = -slopeAt(W, i) * 25 + (W.dRiver[i] < 3 ? 0.2 : 0) + r() * 0.6;
      if (sc > bs) { bs = sc; best = i; }
    }
    if (best < 0) { let bd = 1e9; for (let i = 0; i < NN; i++) if (isDry(W, i)) { const [x, y] = cellXY(i), d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = i; } } }
    if (best < 0) best = Math.floor(cy) * N + Math.floor(cx);
    W.P.pos[s.id] = cellXY(best); taken.push(cellXY(best));
  }
}
const posIdx = (W, id) => { const p = W.P.pos[id]; return p[1] * N + p[0]; };

// ---------- claims (narrative ↔ map) ----------
function mountainMask(W, mid) {
  const m = W.spec.mountains.find(q => q.id === mid); if (!m) return null;
  const [cx, cy] = regionCenter(m.region), R = N / 3;
  return i => { const [x, y] = cellXY(i); return !W.ocean[i] && W.h[i] - W.P.sea > MOUNTAIN_REL && Math.abs(x - cx) < R && Math.abs(y - cy) < R; };
}
function riverAt(W, i) {
  const [x0, y0] = cellXY(i); let best = null, bd = 9;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = x0 + dx, y = y0 + dy; if (x < 0 || y < 0 || x >= N || y >= N) continue;
    const j = y * N + x; if (!W.hy.channel[j] || W.hy.lake[j]) continue;
    const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = j; }
  }
  if (best == null || bd > 2.1) return null;
  const r = W.hy.riverOfSys.get(W.hy.sys[best]);
  return { cell: best, river: r ? r.id : null };
}
function travelDays(W, aId, bId) {
  if (!W.travel.has(aId)) {
    const dist = new Float32Array(NN).fill(1e9), heap = SHARED_HEAP, s = posIdx(W, aId), h = W.h, lim = W.P.sea + MOUNTAIN_REL;
    heap.n = 0; dist[s] = 0; heap.push(s, 0);
    while (heap.n) {
      const c = heap.pop(), dc = heap.key; if (dc > dist[c]) continue;
      const x = c % N, y = (c - x) / N;
      for (let k = 0; k < 8; k++) {
        const xx = x + DX8[k], yy = y + DY8[k]; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
        const nb = yy * N + xx; if (W.ocean[nb] || W.hy.lake[nb]) continue;
        const nd = dc + DD8[k] * (1 + 30 * Math.abs(h[nb] - h[c]) + (h[nb] > lim ? 0.6 : 0));
        if (nd < dist[nb]) { dist[nb] = nd; heap.push(nb, nd); }
      }
    }
    W.travel.set(aId, dist);
  }
  const d = W.travel.get(aId)[posIdx(W, bId)];
  return d >= 1e8 ? null : Math.round(d * KM_PER_CELL / KM_PER_DAY * 10) / 10;
}
function dirOf(W, a, b) {
  const [ax, ay] = W.P.pos[a], [bx, by] = W.P.pos[b];
  const ang = Math.atan2(ay - by, ax - bx);
  return DIRS8[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
}
function crossesMountain(W, a, b, mid) {
  const mask = mountainMask(W, mid); if (!mask) return false;
  const [ax, ay] = W.P.pos[a], [bx, by] = W.P.pos[b]; const n = Math.ceil(Math.hypot(ax - bx, ay - by)); let c = 0;
  for (let k = 0; k <= n; k++) { const x = Math.round(ax + (bx - ax) * k / n), y = Math.round(ay + (by - ay) * k / n); if (mask(y * N + x)) c++; }
  return c >= 2;
}
function upstreamOf(W, a, b) {
  const ra = riverAt(W, posIdx(W, a)); if (!ra) return false;
  const [bx, by] = W.P.pos[b]; let c = ra.cell;
  for (let k = 0; k < 3000 && c >= 0; k++) { const [x, y] = cellXY(c); if (k > 3 && Math.hypot(x - bx, y - by) <= 3) return true; c = W.hy.down[c]; if (c >= 0 && W.ocean[c]) break; }
  return false;
}
const nameOf = (W, id) => {
  const s = W.spec.settlements.find(q => q.id === id); if (s) return s.name;
  const m = W.spec.mountains.find(q => q.id === id); if (m) return m.name;
  const r = W.hy.rivers.find(q => q.id === id); if (r) return r.name;
  const l = W.hy.lakes.find(q => q.id === id); if (l) return l.name;
  return id;
};
function checkClaim(W, c) {
  const has = id => W.P.pos && W.P.pos[id];
  const N_ = id => nameOf(W, id);
  try {
    switch (c.type) {
      case "in_region": { if (!has(c.s)) break; const r = regionOf(...W.P.pos[c.s]); return { ok: r === c.region, label: `${N_(c.s)}位于${REGION_ZH[c.region] || c.region}部`, measured: `实际在${REGION_ZH[r]}部` }; }
      case "coastal": { if (!has(c.s)) break; const ok = REQ_TEST.coast(W, posIdx(W, c.s)); return { ok, label: `${N_(c.s)}临海`, measured: ok ? "临海" : `距海 ${Math.round(W.dOcean[posIdx(W, c.s)] * KM_PER_CELL)} km` }; }
      case "on_river": {
        if (!has(c.s)) break; const r = riverAt(W, posIdx(W, c.s));
        const ok = !!r && (!c.river || r.river === c.river);
        return { ok, label: c.river ? `${N_(c.s)}在${N_(c.river)}畔` : `${N_(c.s)}临河`, measured: r ? (r.river ? `旁边是${N_(r.river)}` : "旁边只有无名小河") : `距最近河道 ${Math.round(W.dRiver[posIdx(W, c.s)] * KM_PER_CELL)} km` };
      }
      case "lakeside": { if (!has(c.s)) break; const ok = REQ_TEST.lakeside(W, posIdx(W, c.s)); return { ok, label: `${N_(c.s)}临湖`, measured: ok ? "临湖" : "附近没有湖" }; }
      case "near_mountain": {
        if (!has(c.s)) break; const mask = c.mountain ? mountainMask(W, c.mountain) : null; const i = posIdx(W, c.s); let ok;
        if (mask) { const [x0, y0] = W.P.pos[c.s]; ok = false; for (let dy = -14; dy <= 14 && !ok; dy++) for (let dx = -14; dx <= 14; dx++) { const x = x0 + dx, y = y0 + dy; if (x < 0 || y < 0 || x >= N || y >= N || dx * dx + dy * dy > 196) continue; if (mask(y * N + x)) { ok = true; break; } } }
        else ok = W.dMount[i] <= 14;
        return { ok, label: `${N_(c.s)}背靠${c.mountain ? N_(c.mountain) : "山脉"}`, measured: ok ? "距山脉 ≤ 28 km" : `距山脉 ${Math.round(W.dMount[i] * KM_PER_CELL)} km` };
      }
      case "biome": { if (!has(c.s)) break; const b = W.biome[posIdx(W, c.s)]; return { ok: b === c.biome, label: `${N_(c.s)}周边是${BIOME_ZH[c.biome] || c.biome}`, measured: `实际为${BIOME_ZH[b]}` }; }
      case "direction": { if (!has(c.a) || !has(c.b)) break; const d = dirOf(W, c.a, c.b); return { ok: d === c.dir, label: `${N_(c.a)}在${N_(c.b)}的${c.dir}方`, measured: `实际在${d}方` }; }
      case "travel_days": {
        if (!has(c.a) || !has(c.b)) break; const d = travelDays(W, c.a, c.b); const cl = +c.days;
        const ok = d != null && Math.abs(cl - d) <= Math.max(0.5, 0.15 * d);
        return { ok, label: `${N_(c.a)}到${N_(c.b)}约 ${cl} 天路程`, measured: d == null ? "陆路不可达" : `路径工具测得 ${d} 天` };
      }
      case "separated_by": { if (!has(c.a) || !has(c.b)) break; const ok = crossesMountain(W, c.a, c.b, c.mountain); return { ok, label: `${N_(c.a)}与${N_(c.b)}之间隔着${N_(c.mountain)}`, measured: ok ? "连线穿过山脉" : "连线不经过该山脉" }; }
      case "upstream_of": { if (!has(c.a) || !has(c.b)) break; const ok = upstreamOf(W, c.a, c.b); return { ok, label: `${N_(c.a)}在${N_(c.b)}的上游`, measured: ok ? "顺流可达" : "顺流到不了" }; }
    }
  } catch (e) { /* fall through */ }
  return { ok: false, label: `无法核查的声明（${c.type}）`, measured: "引用了不存在的实体或未知类型" };
}

// ---------- verifier ----------
function rainShadow(W, m) {
  const r = W.P.ridges.find(q => q.mid === m.id); if (!r) return null;
  const w = W.spec.wind_from, ew = m.orientation === "EW";
  const applicable = ew ? (w === "N" || w === "S") : (w === "E" || w === "W");
  if (!applicable) return { applicable: false };
  const [cx, cy] = regionCenter(m.region);
  const upSign = (w === "W" || w === "N") ? -1 : 1; // upwind side is towards where wind comes from
  let ws = 0, wc = 0, ls = 0, lc = 0;
  for (let along = -N / 5; along <= N / 5; along += 3) for (let off = 22; off <= 80; off += 3) {
    for (const side of [1, -1]) {
      const x = Math.round(ew ? cx + along : cx + side * off), y = Math.round(ew ? cy + side * off : cy + along);
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const i = y * N + x; if (!isDry(W, i)) continue;
      if (side === upSign) { ws += W.moist[i]; wc++; } else { ls += W.moist[i]; lc++; }
    }
  }
  if (wc < 20 || lc < 20) return { applicable: false };
  return { applicable: true, windward: ws / wc, leeward: ls / lc, at: [Math.round(ew ? cx : cx - upSign * 50), Math.round(ew ? cy - upSign * 50 : cy)] };
}
function verify(W, lore) {
  const { spec, P, hy } = W; const C = [];
  const add = o => { if (P.unsat.includes(o.id) && !o.pass) o.status = "declared"; else o.status = o.pass ? "pass" : "fail"; C.push(o); };
  const hasOcean = W.ocean.some(v => v);
  // physical
  add({ id: "phys.sinks", cat: "物理", code: "river_sink", label: "河流必须汇入海洋、湖泊或流出图幅", pass: hy.sinks.length === 0, measured: hy.sinks.length ? `${hy.sinks.length} 处河道终止于无出口洼地` : "所有河道都有出口", at: hy.sinks.slice(0, 6).map(s => cellXY(s.i)) });
  for (const m of spec.mountains) {
    const rs = rainShadow(W, m); if (!rs || !rs.applicable) continue;
    add({ id: `phys.shadow.${m.id}`, cat: "物理", code: "rain_shadow", target: m.id, region: m.region, label: `${m.name}背风坡应比迎风坡干燥`, pass: rs.leeward < rs.windward * 0.85, measured: `迎风坡湿度 ${rs.windward.toFixed(2)}，背风坡 ${rs.leeward.toFixed(2)}`, at: [rs.at] });
  }
  for (const s of spec.settlements) {
    const i = posIdx(W, s.id);
    add({ id: `phys.dry.${s.id}`, cat: "物理", code: "underwater", target: s.id, label: `${s.name}不能建在水里`, pass: isDry(W, i), measured: isDry(W, i) ? "在陆地上" : "位于水域", at: [W.P.pos[s.id]] });
    const sl = slopeAt(W, i);
    add({ id: `phys.slope.${s.id}`, cat: "物理", code: "steep", target: s.id, label: `${s.name}不能建在陡坡上`, pass: sl <= SLOPE_MAX, measured: `坡度 ${(sl * 1000).toFixed(0)}（上限 ${SLOPE_MAX * 1000}）`, at: [W.P.pos[s.id]] });
  }
  // spec
  for (const m of spec.mountains) {
    const [cx, cy] = regionCenter(m.region); let cnt = 0, peak = 0;
    for (let y = Math.floor(cy - N / 6); y < cy + N / 6; y++) for (let x = Math.floor(cx - N / 6); x < cx + N / 6; x++) { const i = y * N + x; if (W.ocean[i]) continue; const rel = W.h[i] - P.sea; peak = Math.max(peak, rel); if (rel > MOUNTAIN_REL) cnt++; }
    add({ id: `spec.mtn.${m.id}`, cat: "规格", code: "mountain_weak", target: m.id, region: m.region, label: `${REGION_ZH[m.region]}部要有${m.name}`, pass: cnt >= MOUNTAIN_MIN_CELLS, measured: `山地 ${cnt} 格（至少 ${MOUNTAIN_MIN_CELLS}），最高相对海拔 ${peak.toFixed(2)}`, at: [[Math.round(cx), Math.round(cy)]] });
  }
  add({ id: "spec.rivers", cat: "规格", code: "few_rivers", label: `至少 ${spec.min_major_rivers} 条大河`, pass: hy.rivers.length >= spec.min_major_rivers, measured: `现有 ${hy.rivers.length} 条（主干 ≥ ${MAJOR_LEN * KM_PER_CELL} km）`, at: [] });
  if (spec.min_lakes > 0) add({ id: "spec.lakes", cat: "规格", code: "few_lakes", label: `至少 ${spec.min_lakes} 个湖泊`, pass: hy.lakes.length >= spec.min_lakes, measured: `现有 ${hy.lakes.length} 个`, at: [] });
  for (const s of spec.settlements) {
    const i = posIdx(W, s.id), p = W.P.pos[s.id];
    if (s.region) { const r = regionOf(...p); add({ id: `spec.region.${s.id}`, cat: "规格", code: "wrong_region", target: s.id, label: `${s.name}应在${REGION_ZH[s.region]}部`, pass: r === s.region, measured: `实际在${REGION_ZH[r]}部`, at: [p] }); }
    for (const q of s.requires) {
      if ((q === "coast" || q === "river_mouth") && !hasOcean) {
        add({ id: `spec.req.${s.id}.${q}`, cat: "规格", code: "no_ocean", target: s.id, req: q, label: `${s.name}（${TYPE_ZH[s.type]}）需要${REQ_ZH[q]}`, pass: false, measured: "规格中整片区域没有海，此要求无法满足", at: [p] });
        continue;
      }
      const ok = REQ_TEST[q](W, i);
      add({ id: `spec.req.${s.id}.${q}`, cat: "规格", code: "req_unmet", target: s.id, req: q, label: `${s.name}（${TYPE_ZH[s.type]}）需要${REQ_ZH[q]}`, pass: ok, measured: ok ? "满足" : "不满足", at: [p] });
    }
  }
  // narrative
  if (lore) for (const e of lore) e.claims.forEach((c, k) => {
    const r = checkClaim(W, c);
    const subj = c.s || c.a;
    add({ id: `lore.${e.id}.${k}`, cat: "叙事", code: "lore_claim", claim: c, target: subj, label: r.label, pass: r.ok, measured: r.measured, at: subj && W.P.pos[subj] ? [W.P.pos[subj]] : [] });
  });
  const fails = C.filter(c => c.status === "fail");
  const counted = C.filter(c => c.status !== "declared");
  return { checks: C, fails, rate: counted.length ? counted.filter(c => c.pass).length / counted.length : 1 };
}

// ---------- tools ----------
const MOVE_TARGETS = ["nearest_coast", "nearest_river", "nearest_river_mouth", "nearest_lake", "near_mountain", "flattest_nearby"];
const TARGET_REQ = { nearest_coast: "coast", nearest_river: "on_river", nearest_river_mouth: "river_mouth", nearest_lake: "lakeside", near_mountain: "near_mountain" };
const TOOL_DOC = `fill_depressions()  — switch hydrology to priority-flood: depressions fill into lakes that overflow, so every river reaches an outlet.
recompute_climate()  — replace noise moisture with an orographic model driven by wind_from (creates rain shadows).
raise_ridge(region, amount)  — raise the mountain ridge in a region (amount 0.02–0.2); creates a ridge if none exists there.
carve_basin(region)  — dig a shallow basin in a region; after fill_depressions it becomes a lake.
set_river_threshold(value)  — flow accumulation needed to draw a river (60–800, current value given). Lower = more and longer rivers.
set_sea_level(value)  — 0.30–0.50. Higher floods more coast.
move_settlement(id, targets)  — move a settlement to the nearest flat dry cell satisfying ALL targets. targets: array of nearest_coast | nearest_river | nearest_river_mouth | nearest_lake | near_mountain | flattest_nearby | region:<R>. The settlement's spec region is preferred automatically.
declare_unsatisfiable(check_id, reason)  — mark a check as impossible to satisfy and stop trying.`;

function applyActions(W, actions) {
  const spec = W.spec; const P = deep(W.P); const results = [];
  const moves = [];
  const order = ["declare_unsatisfiable", "set_sea_level", "raise_ridge", "carve_basin", "recompute_climate", "fill_depressions", "set_river_threshold"];
  const acts = (Array.isArray(actions) ? actions : []).slice(0, 12).map(a => ({ tool: String(a && a.tool || ""), args: (a && a.args) || {} }));
  acts.sort((a, b) => (order.indexOf(a.tool) + 99) % 99 - (order.indexOf(b.tool) + 99) % 99);
  let terrainChanged = false;
  for (const a of acts) {
    const g = a.args;
    switch (a.tool) {
      case "fill_depressions": results.push({ a, ok: true, msg: P.hydro === "filled" ? "已经是填洼模式" : "水文改为 priority-flood 填洼" }); P.hydro = "filled"; terrainChanged = true; break;
      case "recompute_climate": results.push({ a, ok: true, msg: "湿度改由地形抬升降水模型计算" }); P.climate = "orographic"; terrainChanged = true; break;
      case "raise_ridge": {
        const region = REGIONS.includes(g.region) ? g.region : null; if (!region) { results.push({ a, ok: false, msg: "未知区域" }); break; }
        const amt = clamp(+g.amount || 0.1, 0.02, 0.2);
        let r = P.ridges.find(q => q.region === region);
        if (!r) { const m = spec.mountains.find(q => q.region === region); r = { mid: m ? m.id : null, region, orientation: m ? m.orientation : "EW", amp: 0, k: P.ridges.length }; P.ridges.push(r); }
        r.amp = clamp(r.amp + amt, 0, 0.45); terrainChanged = true;
        results.push({ a, ok: true, msg: `${REGION_ZH[region]}部山脊抬高到 ${r.amp.toFixed(2)}` }); break;
      }
      case "carve_basin": {
        const region = REGIONS.includes(g.region) ? g.region : null; if (!region) { results.push({ a, ok: false, msg: "未知区域" }); break; }
        if (P.basins.some(b => b.region === region)) { const b = P.basins.find(b => b.region === region); b.depth = Math.min(0.2, b.depth + 0.05); }
        else P.basins.push({ region, depth: 0.10 });
        terrainChanged = true; results.push({ a, ok: true, msg: `在${REGION_ZH[region]}部挖出盆地` }); break;
      }
      case "set_river_threshold": { const v = clamp(Math.round(+g.value || P.riverThr), 60, 800); results.push({ a, ok: true, msg: `河流阈值 ${P.riverThr} → ${v}` }); P.riverThr = v; terrainChanged = true; break; }
      case "set_sea_level": { const v = clamp(+g.value || P.sea, 0.30, 0.50); results.push({ a, ok: true, msg: `海平面 ${P.sea.toFixed(2)} → ${v.toFixed(2)}` }); P.sea = v; terrainChanged = true; break; }
      case "declare_unsatisfiable": { const id = String(g.check_id || ""); if (!P.unsat.includes(id)) P.unsat.push(id); results.push({ a, ok: true, msg: `声明无法满足：${id}` }); break; }
      case "move_settlement": moves.push(a); break;
      default: results.push({ a, ok: false, msg: `未知工具 ${a.tool}` });
    }
  }
  const W2 = derive(spec, P);
  for (const a of moves) results.push(moveSettlement(W2, a));
  return { W: W2, results, terrainChanged };
}
function moveSettlement(W, a) {
  const id = String(a.args.id || ""); const s = W.spec.settlements.find(q => q.id === id);
  if (!s) return { a, ok: false, msg: `没有聚落 ${id}` };
  let targets = a.args.targets ?? a.args.target ?? [];
  if (!Array.isArray(targets)) targets = [targets];
  targets = targets.map(String);
  const reqs = [], regions = []; let flattest = false;
  for (const t of targets) {
    if (t.startsWith("region:")) { const r = t.slice(7); if (REGIONS.includes(r)) regions.push(r); }
    else if (TARGET_REQ[t]) reqs.push(TARGET_REQ[t]);
    else if (t === "flattest_nearby") flattest = true;
  }
  const [x0, y0] = W.P.pos[id];
  const others = W.spec.settlements.filter(q => q.id !== id).map(q => W.P.pos[q.id]);
  const search = (region) => {
    let best = -1, bd = 1e9;
    for (let i = 0; i < NN; i++) {
      if (!isDry(W, i) || slopeAt(W, i) > SLOPE_MAX * 0.8) continue;
      const [x, y] = cellXY(i); if (x < 2 || y < 2 || x > N - 3 || y > N - 3) continue;
      if (region && regionOf(x, y) !== region) continue;
      if (regions.length && !regions.includes(regionOf(x, y))) continue;
      let ok = true; for (const q of reqs) if (!REQ_TEST[q](W, i)) { ok = false; break; }
      if (!ok) continue;
      if (others.some(o => Math.hypot(o[0] - x, o[1] - y) < 14)) continue;
      const d = Math.hypot(x - x0, y - y0); if (flattest && d > 20) continue;
      const sc = d + (flattest ? slopeAt(W, i) * 800 : 0);
      if (sc < bd) { bd = sc; best = i; }
    }
    return best;
  };
  const pref = regions.length ? null : s.region;
  let best = search(pref), outside = false;
  if (best < 0 && pref) { best = search(null); outside = best >= 0; }
  if (best < 0) return { a, ok: false, msg: `找不到同时满足 [${targets.join(", ")}] 的位置${pref ? `（${REGION_ZH[pref]}部及全图）` : ""}` };
  const to = cellXY(best); W.P.pos[id] = to;
  return { a, ok: true, outside, moved: Math.hypot(to[0] - x0, to[1] - y0), msg: `${s.name} 移动 ${Math.round(Math.hypot(to[0] - x0, to[1] - y0) * KM_PER_CELL)} km${outside ? `（${REGION_ZH[pref]}部内没有合适位置，已移到${REGION_ZH[regionOf(...to)]}部）` : ""}` };
}

// ---------- scripted policies (offline stand-ins for the LLM) ----------
const REQ_TARGET = { coast: "nearest_coast", on_river: "nearest_river", river_mouth: "nearest_river_mouth", lakeside: "nearest_lake", near_mountain: "near_mountain" };
const CLAIM_TARGET = { coastal: "nearest_coast", on_river: "nearest_river", lakeside: "nearest_lake", near_mountain: "near_mountain" };
function scriptedStructured(W, report, history) {
  const acts = [], notes = []; const P = W.P;
  const push = (tool, args) => { const key = tool + JSON.stringify(args); if (!acts.some(a => a.key === key)) acts.push({ tool, args, key }); };
  const lastFails = new Set();
  const last = history[history.length - 1];
  if (last) for (const r of last.results) if (r.a.tool === "move_settlement" && (!r.ok || r.outside || r.moved < 1)) lastFails.add(r.a.args.id);
  const settleT = {};
  for (const v of report.fails) {
    switch (v.code) {
      case "river_sink": push("fill_depressions", {}); notes.push("河道终止在洼地 → 填洼"); break;
      case "rain_shadow": push("recompute_climate", {}); notes.push("背风坡不够干 → 换地形降水模型"); break;
      case "mountain_weak": push("raise_ridge", { region: v.region, amount: 0.12 }); notes.push(`${REGION_ZH[v.region]}部山地不足 → 抬高山脊`); break;
      case "few_rivers": push("set_river_threshold", { value: Math.round(P.riverThr * 0.62) }); notes.push("大河数量不足 → 降低河流阈值"); break;
      case "few_lakes": {
        if (P.hydro !== "filled") { push("fill_depressions", {}); break; }
        const used = new Set(P.basins.map(b => b.region));
        const want = W.spec.settlements.find(s => s.requires.includes("lakeside") && s.region && !used.has(s.region));
        const reg = want ? want.region : ["C", "SW", "NE", "W", "S"].find(r => !used.has(r)) || "C";
        push("carve_basin", { region: reg }); notes.push(`湖泊不足 → 在${REGION_ZH[reg]}部挖盆地`); break;
      }
      case "no_ocean": push("declare_unsatisfiable", { check_id: v.id, reason: "规格没有海，港口无法临海" }); notes.push("内陆区域不可能有港口 → 声明无法满足"); break;
      case "req_unmet": case "underwater": case "steep": case "wrong_region": case "lore_claim": {
        const s = W.spec.settlements.find(q => q.id === v.target); if (!s) break;
        settleT[s.id] = settleT[s.id] || new Set();
        if (v.code === "lore_claim") { const t = CLAIM_TARGET[v.claim.type]; if (t) settleT[s.id].add(t); else if (v.claim.type === "in_region") settleT[s.id].add("region:" + v.claim.region); }
        break;
      }
    }
  }
  for (const s of W.spec.settlements) {
    const failing = report.fails.filter(f => f.target === s.id && ["req_unmet", "underwater", "steep", "wrong_region"].includes(f.code));
    const loreT = settleT[s.id];
    if (!failing.length && !(loreT && loreT.size)) continue;
    const tg = new Set(loreT || []);
    s.requires.forEach(q => tg.add(REQ_TARGET[q]));
    if (!tg.size) tg.add("flattest_nearby");
    if (lastFails.has(s.id)) {
      // moving alone did not work last round: change the terrain instead
      if (s.requires.includes("lakeside") && s.region && !P.basins.some(b => b.region === s.region)) { push("carve_basin", { region: s.region }); if (P.hydro !== "filled") push("fill_depressions", {}); notes.push(`${s.name}附近无湖 → 在${REGION_ZH[s.region]}部造湖`); }
      else if (s.requires.some(q => q === "on_river" || q === "river_mouth") && P.riverThr > 90) { push("set_river_threshold", { value: Math.round(P.riverThr * 0.6) }); notes.push(`${s.name}附近无合适河道 → 降低河流阈值`); }
      else if (s.requires.includes("near_mountain") && s.region) { push("raise_ridge", { region: s.region, amount: 0.12 }); notes.push(`${s.name}附近山地不够 → 抬高山脊`); }
      else { failing.forEach(f => push("declare_unsatisfiable", { check_id: f.id, reason: "多次移动仍无法满足" })); notes.push(`${s.name}多次移动失败 → 声明无法满足`); continue; }
    }
    push("move_settlement", { id: s.id, targets: [...tg] });
    notes.push(`${s.name}：${failing.map(f => f.label.replace(s.name, "").replace(/^（.*?）/, "")).join("、") || "与设定不符"} → 移动`);
  }
  return { analysis: notes.length ? [...new Set(notes)].join("；") + "。" : "没有可用的修正。", actions: acts.map(({ tool, args }) => ({ tool, args })) };
}
function scriptedBlind(W, report, history, it) {
  const r = rng(W.P.seed * 31 + it * 7);
  const pick = a => a[Math.floor(r() * a.length)];
  const s = W.spec.settlements.length ? pick(W.spec.settlements) : null;
  const pool = [
    () => ({ tool: "raise_ridge", args: { region: pick(REGIONS), amount: 0.08 } }),
    () => ({ tool: "set_river_threshold", args: { value: Math.round(W.P.riverThr * (0.6 + r() * 0.8)) } }),
    () => ({ tool: "set_sea_level", args: { value: +(0.36 + r() * 0.08).toFixed(2) } }),
    () => ({ tool: "fill_depressions", args: {} }),
    () => ({ tool: "carve_basin", args: { region: pick(REGIONS) } }),
    () => s && ({ tool: "move_settlement", args: { id: s.id, targets: [pick(MOVE_TARGETS)] } }),
  ];
  const i1 = Math.floor(r() * pool.length); let i2 = Math.floor(r() * pool.length); if (i2 === i1) i2 = (i2 + 1) % pool.length;
  const acts = [pool[i1](), pool[i2]()].filter(Boolean);
  return { analysis: "只知道本轮结果是“不通过”，不知道哪里出错，只能试探性地调整参数。", actions: acts };
}

// ---------- map facts & scripted lore ----------
function settlementFacts(W, s) {
  const i = posIdx(W, s.id), rv = riverAt(W, i);
  const nearM = W.spec.mountains.filter(m => checkClaim(W, { type: "near_mountain", s: s.id, mountain: m.id }).ok).map(m => m.id);
  return { id: s.id, name: s.name, type: s.type, region: regionOf(...W.P.pos[s.id]), biome: W.biome[i], coastal: REQ_TEST.coast(W, i), river: rv ? rv.river : null, lakeside: REQ_TEST.lakeside(W, i), near_mountains: nearM };
}
function mapFacts(W) {
  const S = W.spec.settlements;
  const pairs = [];
  for (const a of S) for (const b of S) {
    if (a.id >= b.id) continue;
    pairs.push({ a: a.id, b: b.id, a_lies_to_the_dir_of_b: dirOf(W, a.id, b.id), travel_days: travelDays(W, a.id, b.id), separated_by: W.spec.mountains.filter(m => crossesMountain(W, a.id, b.id, m.id)).map(m => m.id), a_upstream_of_b: upstreamOf(W, a.id, b.id), b_upstream_of_a: upstreamOf(W, b.id, a.id) });
  }
  return {
    region: W.spec.name,
    settlements: S.map(s => settlementFacts(W, s)),
    rivers: W.hy.rivers.map(r => ({ id: r.id, name: r.name, length_km: r.lengthKm, ends: r.kind === "sea" ? `在${REGION_ZH[r.mouthRegion]}部入海` : "流出图幅", passes: r.regions.map(x => REGION_ZH[x]) })),
    lakes: W.hy.lakes.map(l => ({ id: l.id, name: l.name, region: REGION_ZH[l.region] })),
    mountains: W.spec.mountains.map(m => ({ id: m.id, name: m.name, region: REGION_ZH[m.region] })),
    pairs,
  };
}
const FLAVOR = {
  port: ["咸雾终年不散，码头上的灯常在无风的夜里摇晃", "渔船与走私船共用同一段栈桥，镇上的人从不数船"],
  city: ["钟楼整点敲响时总会多出一声", "旧城墙内的街巷按奇怪的几何图形排列，没人记得是谁设计的"],
  town: ["水车日夜不停，磨坊主坚称河水比十年前更重了", "集市每旬一次，外乡人总在散市后才离开"],
  village: ["村口的界石刻着无人能读的符号", "村民在日落前关好所有朝山的窗户"],
  fortress: ["石砌要塞守着山口，守军名册上的人比营房里的多", "塔楼的烽火已经很多年没有点过"],
};
function nearestOther(W, s) {
  let best = null, bd = 1e9; const [x, y] = W.P.pos[s.id];
  for (const o of W.spec.settlements) { if (o.id === s.id) continue; const [ox, oy] = W.P.pos[o.id]; const d = Math.hypot(ox - x, oy - y); if (d < bd) { bd = d; best = o; } }
  return best ? { o: best, straight: bd } : null;
}
function scriptedLoreEntry(W, s, k, mode) {
  const f = settlementFacts(W, s); const bits = []; const claims = [];
  bits.push(`[[${s.id}]]位于${REGION_ZH[f.region]}部，${FLAVOR[s.type][k % 2]}。`);
  claims.push({ type: "in_region", s: s.id, region: f.region });
  if (f.coastal && f.river) { bits.push(`[[${f.river}]]在城边汇入大海。`); claims.push({ type: "coastal", s: s.id }, { type: "on_river", s: s.id, river: f.river }); }
  else if (f.coastal) { bits.push("镇子正对着灰色的海。"); claims.push({ type: "coastal", s: s.id }); }
  else if (f.river) { bits.push(`[[${f.river}]]从镇旁流过。`); claims.push({ type: "on_river", s: s.id, river: f.river }); }
  if (f.lakeside) { bits.push("镇外的湖面在冬天也不结冰。"); claims.push({ type: "lakeside", s: s.id }); }
  if (f.near_mountains.length) { bits.push(`背后是[[${f.near_mountains[0]}]]的阴影。`); claims.push({ type: "near_mountain", s: s.id, mountain: f.near_mountains[0] }); }
  bits.push(`四周是${BIOME_ZH[f.biome]}。`); claims.push({ type: "biome", s: s.id, biome: f.biome });
  const no = nearestOther(W, s);
  if (no) {
    const days = mode === "draft" ? Math.round(no.straight * KM_PER_CELL / KM_PER_DAY * 2) / 2 : travelDays(W, s.id, no.o.id);
    if (days != null) { bits.push(`去往[[${no.o.id}]]约需 ${days} 天，路在${dirOf(W, no.o.id, s.id)}方。`); claims.push({ type: "travel_days", a: s.id, b: no.o.id, days }, { type: "direction", a: no.o.id, b: s.id, dir: dirOf(W, no.o.id, s.id) }); }
    const sep = W.spec.mountains.find(m => crossesMountain(W, s.id, no.o.id, m.id));
    if (sep) { bits.push(`两地之间隔着[[${sep.id}]]。`); claims.push({ type: "separated_by", a: s.id, b: no.o.id, mountain: sep.id }); }
  }
  return { id: "E" + (k + 1), subject: s.id, title: `${s.name}`, text: bits.join(""), claims };
}
function scriptedLore(W, mode) { return W.spec.settlements.map((s, k) => scriptedLoreEntry(W, s, k, mode)); }

if (typeof module !== "undefined") module.exports = { N, NN, normalizeSpec, initParams, derive, verify, applyActions, scriptedStructured, scriptedBlind, scriptedLore, scriptedLoreEntry, mapFacts, checkClaim, REGION_ZH, cellXY, regionOf };
// ===================== END CORE =====================
