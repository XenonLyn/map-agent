// ===================== UI =====================
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

const S = {
  spec: null, snaps: [], cur: -1, trace: [], lore: null, sample: null, running: false, ctl: null,
  focus: null, highlight: null, llmCalls: 0, t0: 0, elapsed: 0,
  layers: { base: "biome", rivers: true, settle: true, marks: true, grid: true }, view: "3d",
};
const last = () => S.snaps[S.snaps.length - 1];
const curSnap = () => S.snaps[S.cur];
const engine = () => document.querySelector('input[name="engine"]:checked').value;

// ---------- Claude availability ----------
(async () => {
  const st = $("#agentStatus");
  try {
    if (!window.claude || !window.claude.use) throw 0;
    const s = await window.claude.use("sample");
    if (!s) throw 0;
    S.sample = s;
    $("#engClaude").disabled = false;
    st.textContent = "Claude 可用：切换到 Claude 后，规划、修正和写设定都是真实模型调用（第一次调用会请求授权）";
    st.dataset.state = "ok";
  } catch {
    st.textContent = "当前环境无法调用 Claude，只能使用离线脚本策略";
    st.dataset.state = "off";
  }
})();

// ---------- presets ----------
function initControls() {
  const sel = $("#preset");
  PRESETS.forEach((p, k) => sel.add(new Option(p.label, k)));
  sel.onchange = () => { $("#desc").value = PRESETS[+sel.value].text; };
  $("#desc").value = PRESETS[0].text;
  for (const r of REGIONS) { $("#editR").add(new Option(REGION_ZH[r] + "部", r)); $("#ridgeR").add(new Option(REGION_ZH[r] + "部", r)); }
  document.querySelectorAll('input[name="engine"]').forEach(el => el.onchange = () => { $("#tierWrap").hidden = engine() !== "claude"; });
  $("#run").onclick = () => runAgent();
  $("#stop").onclick = () => { if (S.ctl) S.ctl.abort(); };
  $("#loreBtn").onclick = () => genLore();
  $("#moveBtn").onclick = () => editMove();
  $("#ridgeBtn").onclick = () => editRidge();
  $("#rewriteBtn").onclick = () => rewriteStale();
  $("#obeyBtn").onclick = () => obeyLore();
  document.querySelectorAll("[data-layer]").forEach(el => el.onchange = () => {
    const k = el.dataset.layer; if (k === "base") S.layers.base = el.value; else S.layers[k] = el.checked; renderMap();
  });
  const cv = $("#map");
  cv.addEventListener("mousemove", e => {
    const sn = curSnap(); if (!sn) return;
    const r = cv.getBoundingClientRect(); const x = Math.floor((e.clientX - r.left) / r.width * N), y = Math.floor((e.clientY - r.top) / r.height * N);
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    showCell(sn.W, x, y);
  });
  cv.addEventListener("mouseleave", () => { $("#readout").textContent = READOUT_HINT; });
  cv.addEventListener("click", e => {
    const sn = curSnap(); if (!sn) return;
    const r = cv.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * N, y = (e.clientY - r.top) / r.height * N;
    let best = null, bd = 1e9;
    for (const s of sn.W.spec.settlements) { const [px, py] = sn.W.P.pos[s.id]; const d = Math.hypot(px + 0.5 - x, py + 0.5 - y); if (d < PLAN_R[s.type] * 1.1 && d < bd) { bd = d; best = s.id; } }
    if (best) selectCity(best);
  });
  $("#cityFly").onclick = () => { if (S.city) { setViewMode("3d"); flyTo(S.city); $("#view3d").scrollIntoView({ behavior: "smooth", block: "center" }); } };
  document.querySelectorAll("[data-view]").forEach(b => b.onclick = () => setViewMode(b.dataset.view));
  $("#exag").oninput = e => { if (V3) { V3.exag = +e.target.value; if (S.view === "3d") update3D(); } };
  $("#camReset").onclick = () => { setView("oblique"); };
  $("#gmFog").onchange = e => { GM.fog = e.target.checked; renderGameMap(true); };
  $("#gmRedraw").onclick = () => renderGameMap(true);
  const gm = $("#gmCanvas");
  gm.addEventListener("click", e => { const ic = gmPick(e); if (ic) { S.city = ic.sid; renderCity(); gmFocus(GM.focus === ic.sid ? null : ic.sid); } });
  $("#gmAll").onclick = () => gmFocus(null);
  $("#gmZoom").onclick = () => gmFocus(S.city);
  gm.addEventListener("mousemove", e => { const ic = gmPick(e); gm.style.cursor = ic ? "pointer" : "default"; if (GM.hover !== ic) { GM.hover = ic; renderGameMap(); } });
  $("#camTop").onclick = () => { setView("top"); };
}
const READOUT_HINT = "把鼠标移到地图上查看格点信息。";
function showCell(W, x, y) {
  const i = y * N + x, rel = W.h[i] - W.P.sea;
  const elev = W.ocean[i] ? `水深约 ${Math.round(-rel * 6000)} m` : `海拔约 ${Math.round(Math.max(0, rel) * 6000)} m`;
  $("#readout").textContent = `${REGION_ZH[regionOf(x, y)]}部，距西界 ${x * KM_PER_CELL} km、北界 ${y * KM_PER_CELL} km；${elev}，湿度 ${W.moist[i].toFixed(2)}，${BIOME_ZH[W.biome[i]]}${W.hy.channel[i] && !W.hy.lake[i] ? "，河道" : ""}`;
}
function setViewMode(v) {
  if ((v === "3d" || v === "game") && !(V3 && (V3.ok || init3D()))) v = "2d";
  S.view = v;
  document.querySelectorAll("[data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  $("#map").hidden = v !== "2d";
  $("#view3d").hidden = v !== "3d";
  $("#ctl3d").hidden = v !== "3d";
  $("#gamemap").hidden = v !== "game";
  $("#ctlgame").hidden = v !== "game";
  $("#readout").textContent = v === "game" ? "俯视渲染叠加探索迷雾与图标；点击城镇图标可在下方查看它的规划详图。" : READOUT_HINT;
  if (v === "3d") resize3D();
  renderMap();
}

function setBusy(b, msg) {
  S.running = b;
  for (const id of ["#run", "#loreBtn", "#moveBtn", "#ridgeBtn", "#rewriteBtn", "#obeyBtn"]) $(id).disabled = b;
  $("#stop").hidden = !(b && engine() === "claude");
  $("#busy").textContent = b ? (msg || "运行中") : "";
  if (!b) updateEditButtons();
}

// ---------- snapshots & trace ----------
function pushSnap(W, label, kind) {
  S.snaps.push({ W, label, kind, rep: null });
  S.cur = S.snaps.length - 1;
  refreshAll();
}
function reportOf(sn) {
  if (!sn.rep || sn.repLore !== S.loreVersion) { sn.rep = verify(sn.W, sn === last() ? activeLore() : null); sn.repLore = S.loreVersion; }
  return sn.rep;
}
S.loreVersion = 0;
const activeLore = () => S.lore ? S.lore.filter(e => !e.draft) : null;
function bumpLore() { S.loreVersion++; }
function addTrace(item) { S.trace.push(item); renderTrace(); return item; }

function refreshAll() { renderScrub(); renderMap(); renderChecks(); renderMetrics(); renderTrace(); renderLore(); renderCity(); updateEditButtons(); }

// ---------- LLM helpers ----------
async function llmJSON(prompt, what, item) {
  S.llmCalls++;
  const t = performance.now();
  if (item) { item.pending = `${what}：等待 Claude…`; renderTrace(); }
  try {
    const out = await S.sample.json(prompt, {
      modelTier: $("#tier").value, signal: S.ctl.signal, cache: false,
      onText: ({ text }) => { if (item) { item.pending = `${what}：Claude 正在输出（${text.length} 字符）`; renderTrace(); } },
    });
    if (item) { item.pending = null; item.llm = ((performance.now() - t) / 1000).toFixed(1) + " s"; }
    return out;
  } catch (e) {
    if (item) item.pending = null;
    const map = { cancelled: "已停止", not_granted: "未授权调用 Claude，已切回离线模式", rate_limited: "调用太频繁或额度已用完，请稍后再试", invalid_json: "Claude 的回复不是合法 JSON", refused: "Claude 拒绝了这次请求", sampling_disabled: "此账号无法调用 Claude" };
    const msg = map[e && e.code] || `调用失败（${(e && e.code) || e}）`;
    if (e && (e.code === "not_granted" || e.code === "sampling_disabled")) { $("#engOff").checked = true; $("#engClaude").disabled = true; $("#tierWrap").hidden = true; }
    const err = new Error(msg); err.code = e && e.code; throw err;
  }
}

const SPEC_SCHEMA = `{"name": string, "seed": integer, "ocean_side": "E"|"W"|"N"|"S"|"all"|"none", "wind_from": "E"|"W"|"N"|"S",
 "mountains": [{"name": string, "region": R, "orientation": "EW"|"NS"}],
 "min_major_rivers": 0-6, "min_lakes": 0-4,
 "settlements": [{"name": string, "type": "port"|"city"|"town"|"village"|"fortress", "region": R, "requires": subset of ["coast","river_mouth","on_river","lakeside","near_mountain"]}]}
R is one of NW, N, NE, W, C, E, SW, S, SE (a 3x3 grid, north is up).`;

async function llmPlan(desc, item) {
  const prompt = `You turn a worldbuilding description into a WorldSpec for a procedural regional map generator (${N}x${N} cells, 2 km per cell, so ${N * 2} km across; north is up).
Reply with only one JSON object of this shape:
${SPEC_SCHEMA}
Rules:
- "all" means an island, "none" means landlocked.
- At most 6 mountains and 12 settlements. The region is large, so 6-10 settlements spread over several regions work well. Keep names in the description's language.
- Encode only what the description states or clearly implies. If the description asks for something impossible (for example a port in a landlocked region), keep that requirement anyway: a verifier will flag it later.

Description:
"""${desc.slice(0, 3000)}"""`;
  return llmJSON(prompt, "规划 WorldSpec", item);
}

function regionSummary(W) {
  const o = {};
  for (const r of REGIONS) o[r] = { land_pct: 0, peak_rel_elev: 0, mountain_cells: 0, rivers: new Set(), sea_mouths: 0, lakes: 0, settlements: [] };
  for (let i = 0; i < NN; i++) {
    const [x, y] = cellXY(i), g = o[regionOf(x, y)];
    if (W.ocean[i]) continue;
    g.land_pct++; const rel = W.h[i] - W.P.sea; g.peak_rel_elev = Math.max(g.peak_rel_elev, rel); if (rel > MOUNTAIN_REL) g.mountain_cells++;
    if (W.hy.channel[i] && !W.hy.lake[i]) { const r = W.hy.riverOfSys.get(W.hy.sys[i]); if (r) g.rivers.add(r.id); }
  }
  W.hy.lakes.forEach(l => o[l.region].lakes++);
  W.hy.rivers.forEach(r => { if (r.kind === "sea") o[r.mouthRegion].sea_mouths++; });
  for (const s of W.spec.settlements) o[regionOf(...W.P.pos[s.id])].settlements.push(s.id);
  const area = (N / 3) ** 2;
  for (const r of REGIONS) { const g = o[r]; g.land_pct = Math.round(g.land_pct / area * 100); g.peak_rel_elev = +g.peak_rel_elev.toFixed(2); g.rivers = [...g.rivers]; }
  return o;
}

async function llmRepair(W, rep, hist, fb, item) {
  const params = {
    sea_level: +W.P.sea.toFixed(2), hydrology: W.P.hydro, climate: W.P.climate, river_threshold: W.P.riverThr,
    ridges: W.P.ridges.map(r => ({ region: r.region, orientation: r.orientation, amp: +r.amp.toFixed(2) })),
    basins: W.P.basins.map(b => b.region), declared_unsatisfiable: W.P.unsat,
    settlement_regions: Object.fromEntries(W.spec.settlements.map(s => [s.id, regionOf(...W.P.pos[s.id])])),
  };
  const feedback = fb === "structured"
    ? "Structured verifier report (failed checks only):\n" + JSON.stringify(rep.fails.map(f => ({ id: f.id, code: f.code, target: f.target, region: f.region, requirement: f.req, check: f.label, measured: f.measured, claim: f.claim })), null, 0)
    : "Verifier verdict: FAIL. No further detail is available in this condition.";
  const history = hist.slice(-3).map((h, k) => ({ round: hist.length - Math.min(3, hist.length) + k + 1, actions: h.actions, results: h.results.map(r => `${r.a.tool}: ${r.ok ? "ok" : "failed"} — ${r.msg}`) }));
  const prompt = `You are the repair agent in a regional-map generation loop. The generator is procedural; you can only change it through the tools below. After your actions the map is rebuilt and verified again.

WorldSpec:
${JSON.stringify(W.spec)}

Current generator state:
${JSON.stringify(params)}

Per-region map summary (3x3 grid):
${JSON.stringify(regionSummary(W))}

${feedback}

Previous rounds:
${history.length ? JSON.stringify(history) : "none"}

Tools:
${TOOL_DOC}

Reply with only JSON: {"analysis": "one or two sentences in Chinese explaining your plan", "actions": [{"tool": "<name>", "args": {...}}], "stop": false}
Use the fewest edits that address the failures. Terrain and hydrology tools run before settlement moves within a round. If a move failed or kept a settlement outside its region, change the terrain (e.g. lower the river threshold, carve a basin) instead of repeating it. If a check cannot be satisfied at all, call declare_unsatisfiable with its id. Set "stop": true only when nothing useful is left to try.`;
  const out = await llmJSON(prompt, "决定修正动作", item);
  return { analysis: String(out.analysis || ""), actions: Array.isArray(out.actions) ? out.actions : [], stop: !!out.stop };
}

const CLAIM_DOC = `Claim objects (use entity ids):
{"type":"in_region","s":"S1","region":"E"}                     region code: NW,N,NE,W,C,E,SW,S,SE
{"type":"coastal","s":"S1"}
{"type":"on_river","s":"S1","river":"R1"}
{"type":"lakeside","s":"S1"}
{"type":"near_mountain","s":"S1","mountain":"M1"}
{"type":"biome","s":"S1","biome":"forest"}                      biome: snow,rock,tundra,taiga,steppe,desert,grassland,forest,marsh,rainforest
{"type":"direction","a":"S2","b":"S1","dir":"东北"}             a lies to the dir of b; dir: 东,东南,南,西南,西,西北,北,东北
{"type":"travel_days","a":"S1","b":"S2","days":3.5}
{"type":"separated_by","a":"S1","b":"S2","mountain":"M1"}
{"type":"upstream_of","a":"S2","b":"S1"}`;

async function llmLore(facts, item) {
  const prompt = `Write one short worldbuilding entry per settlement for a tabletop campaign region called "${facts.region}". Tone: quiet, uncanny, 1920s or low-fantasy depending on the names. Write in Chinese, 50-110 characters per entry.
Use ONLY these map facts for geography. Refer to entities by writing [[ID]] in the text (e.g. [[S1]], [[R1]], [[M1]]) instead of their names.
Every geographic statement in the text must also appear as a machine-checkable claim. Non-geographic flavour needs no claim.

${CLAIM_DOC}

Map facts:
${JSON.stringify(facts)}

Reply with only JSON: {"entries":[{"subject":"S1","title":"...","text":"...","claims":[...]}]}`;
  const out = await llmJSON(prompt, "起草世界观", item);
  return Array.isArray(out.entries) ? out.entries : Array.isArray(out) ? out : [];
}
async function llmReviseLore(entries, failures, facts, item, why) {
  const prompt = `These worldbuilding entries contain geographic claims that ${why}. Rewrite ONLY the listed entries so every claim matches the map facts. Keep the tone and the [[ID]] references; keep each entry 50-110 Chinese characters; make the claims list match the new text.

${CLAIM_DOC}

Entries to fix:
${JSON.stringify(entries)}

Failed claims (with what the map actually shows):
${JSON.stringify(failures)}

Current map facts:
${JSON.stringify(facts)}

Reply with only JSON: {"entries":[{"subject":"S1","title":"...","text":"...","claims":[...]}]}`;
  const out = await llmJSON(prompt, "修订世界观", item);
  return Array.isArray(out.entries) ? out.entries : [];
}
function normalizeEntries(list, W, idOffset) {
  const ids = new Set(W.spec.settlements.map(s => s.id));
  return (list || []).filter(e => e && ids.has(String(e.subject))).map((e, k) => ({
    id: "E" + (idOffset + k + 1), subject: String(e.subject), title: String(e.title || nameOf(W, e.subject)).slice(0, 30),
    text: String(e.text || "").slice(0, 400),
    claims: (Array.isArray(e.claims) ? e.claims : []).filter(c => c && typeof c.type === "string").slice(0, 10).map(c => { const o = {}; for (const [k2, v] of Object.entries(c)) o[k2] = k2 === "days" ? +v : String(v); return o; }),
  }));
}

// ---------- the agent loop ----------
async function repairLoop(W, { fb, maxIter, withLore, eng, title }) {
  const hist = [];
  let rep = verify(W, withLore ? activeLore() : null);
  for (let it = 1; it <= maxIter; it++) {
    if (!rep.fails.length) { addTrace({ kind: "done", title: "全部检查通过", body: "验证器没有发现剩余违规，循环结束。" }); break; }
    const item = addTrace({ kind: "iter", title: `${title} 第 ${it} 轮`, before: rep.fails.length });
    let pol;
    if (eng === "claude") pol = await llmRepair(W, rep, hist, fb, item);
    else pol = fb === "structured" ? scriptedStructured(W, rep, hist) : scriptedBlind(W, rep, hist, it);
    item.body = pol.analysis;
    if (!pol.actions.length || pol.stop) { item.after = rep.fails.length; item.body += (item.body ? " " : "") + "（agent 没有给出新动作，循环结束）"; renderTrace(); break; }
    const r = applyActions(W, pol.actions);
    hist.push({ actions: pol.actions, results: r.results });
    W = r.W;
    rep = verify(W, withLore ? activeLore() : null);
    item.after = rep.fails.length;
    item.actions = r.results.map(x => ({ call: `${x.a.tool}(${Object.values(x.a.args || {}).map(v => JSON.stringify(v)).join(", ")})`, ok: x.ok && !x.outside, msg: x.msg }));
    pushSnap(W, `${title}${it}`, "iter");
    await frame();
    if (it === maxIter && rep.fails.length) addTrace({ kind: "done", title: "达到迭代上限", body: `仍有 ${rep.fails.length} 项违规。` });
  }
  return W;
}

async function runAgent() {
  if (S.running) return;
  const eng = engine(), fb = $("#feedback").value, maxIter = clamp(+$("#maxIter").value || 6, 1, 10);
  S.ctl = new AbortController(); S.snaps = []; S.trace = []; S.lore = null; bumpLore(); $("#loreLog").innerHTML = ""; $("#editResult").textContent = "先生成世界观，再来这里修改。"; S.llmCalls = 0; S.focus = null; S.t0 = performance.now();
  setBusy(true, "生成中");
  try {
    const preset = PRESETS[+$("#preset").value];
    const desc = $("#desc").value.trim();
    let raw;
    if (eng === "claude") {
      const item = addTrace({ kind: "plan", title: "规划器", body: "把描述转成 WorldSpec（结构化规格）。" });
      raw = await llmPlan(desc, item);
    } else {
      raw = preset.spec;
      addTrace({ kind: "plan", title: "规划器（离线）", body: desc !== preset.text ? "离线模式只能读取预设写好的 WorldSpec，你改过的描述没有被使用。要解析自定义描述，请切换到 Claude。" : "使用预设写好的 WorldSpec。离线模式不调用模型。" });
    }
    S.spec = normalizeSpec(raw);
    $("#specView").textContent = JSON.stringify(S.spec, null, 2);
    fillEditSelects();
    await frame();
    let W = derive(S.spec, initParams(S.spec));
    const rep0 = verify(W, null);
    addTrace({ kind: "build", title: "生成器", body: `按默认参数生成：噪声地形、噪声湿度、不填洼的 D8 水文。验证器发现 ${rep0.fails.length} 项违规。` });
    pushSnap(W, "初始", "init");
    if (fb === "none") addTrace({ kind: "done", title: "无反馈条件", body: "只生成一次，不进入修正循环。" });
    else await repairLoop(W, { fb, maxIter, withLore: false, eng, title: "修正" });
  } catch (e) {
    addTrace({ kind: "error", title: "中断", body: e.message || String(e) });
  } finally {
    S.elapsed = (performance.now() - S.t0) / 1000;
    setBusy(false); refreshAll();
  }
}

// ---------- lore ----------
function claimStatuses(W) {
  for (const e of S.lore || []) for (const c of e.claims) {
    const r = checkClaim(W, c); const prev = c.status;
    c.result = r;
    if (r.ok) c.status = "ok";
    else if (prev === "ok" || prev === "stale") c.status = "stale";
    else c.status = "false";
  }
}
async function genLore() {
  const sn = last(); if (!sn || S.running) return;
  const eng = engine();
  S.ctl = new AbortController();
  setBusy(true, "写设定中");
  const log = [];
  const W = sn.W;
  try {
    S.lore = null;
    if (eng === "claude") {
      const facts = mapFacts(W);
      const item = { kind: "lore" }; S.loreItem = item;
      log.push("通过地图查询工具取得聚落、河流、山脉和两两路程等事实，交给 Claude 起草。");
      renderLoreLog(log, item);
      let entries = normalizeEntries(await llmLore(facts, item), W, 0);
      S.lore = entries; S.lore.forEach(e => e.claims.forEach(c => c.status = null)); claimStatuses(W);
      const bad = entries.filter(e => e.claims.some(c => c.status !== "ok"));
      const nClaims = entries.reduce((a, e) => a + e.claims.length, 0);
      log.push(`起草完成：${entries.length} 条设定，${nClaims} 条地理声明，其中 ${countBad()} 条与地图不符。`);
      renderLoreLog(log, item); renderLore();
      if (bad.length) {
        const failures = bad.flatMap(e => e.claims.filter(c => c.status !== "ok").map(c => ({ entry: e.subject, claim: c, map_says: c.result.measured })));
        const fixed = normalizeEntries(await llmReviseLore(bad.map(({ subject, title, text, claims }) => ({ subject, title, text, claims })), failures, facts, item, "contradict the map"), W, 0);
        mergeEntries(fixed); S.lore.forEach(e => e.claims.forEach(c => { if (c.status !== "ok") c.status = null; })); claimStatuses(W);
        log.push(`修订 ${fixed.length} 条后，还剩 ${countBad()} 条声明不符。`);
      }
    } else {
      S.lore = scriptedLore(W, "draft");
      S.lore.forEach(e => e.claims.forEach(c => c.status = null)); claimStatuses(W);
      log.push("起草（离线模板）：路程按两地直线距离估算，没有调用路径工具。");
      log.push(`核查：${S.lore.reduce((a, e) => a + e.claims.length, 0)} 条地理声明，${countBad()} 条与地图不符。`);
      renderLore(); renderLoreLog(log); await frame();
      const bad = S.lore.filter(e => e.claims.some(c => c.status !== "ok"));
      if (bad.length) {
        for (const e of bad) { const k = S.lore.indexOf(e); const s = S.spec.settlements.find(q => q.id === e.subject); S.lore[k] = scriptedLoreEntry(W, s, k, "final"); }
        S.lore.forEach(e => e.claims.forEach(c => { if (c.status !== "ok") c.status = null; })); claimStatuses(W);
        log.push(`修订：对不符的 ${bad.length} 条设定改用路径工具的实测路程重写，剩余不符 ${countBad()} 条。`);
      } else log.push("没有需要修订的声明。");
    }
    log.push("这些声明现在也是地图的约束：之后编辑地图时，被影响的设定会被标记为过期。");
  } catch (e) {
    log.push("中断：" + (e.message || e));
  } finally {
    bumpLore(); renderLoreLog(log); setBusy(false); refreshAll();
  }
}
function countBad() { return (S.lore || []).reduce((a, e) => a + e.claims.filter(c => c.status !== "ok").length, 0); }
function mergeEntries(fixed) {
  for (const f of fixed) {
    const k = S.lore.findIndex(e => e.subject === f.subject);
    if (k >= 0) { f.id = S.lore[k].id; S.lore[k] = f; }
  }
}
function renderLoreLog(log, item) {
  $("#loreLog").innerHTML = log.map(l => `<li>${esc(l)}</li>`).join("") + (item && item.pending ? `<li class="pending">${esc(item.pending)}</li>` : "");
}

async function rewriteStale() {
  const sn = last(); if (!sn || !S.lore || S.running) return;
  const W = sn.W; const bad = S.lore.filter(e => e.claims.some(c => c.status !== "ok"));
  if (!bad.length) { $("#editResult").textContent = "没有过期或不符的设定。"; return; }
  S.ctl = new AbortController(); setBusy(true, "重写设定中");
  try {
    if (engine() === "claude") {
      const facts = mapFacts(W);
      const failures = bad.flatMap(e => e.claims.filter(c => c.status !== "ok").map(c => ({ entry: e.subject, claim: c, map_says: c.result.measured })));
      const item = {}; S.loreItem = null;
      $("#editResult").textContent = "Claude 正在重写过期设定…";
      const fixed = normalizeEntries(await llmReviseLore(bad.map(({ subject, title, text, claims }) => ({ subject, title, text, claims })), failures, facts, item, "became outdated after the map was edited"), W, 0);
      mergeEntries(fixed);
    } else {
      for (const e of bad) { const k = S.lore.indexOf(e); const s = S.spec.settlements.find(q => q.id === e.subject); S.lore[k] = scriptedLoreEntry(W, s, k, "final"); }
    }
    S.lore.forEach(e => e.claims.forEach(c => { if (c.status !== "ok") c.status = null; })); claimStatuses(W);
    $("#editResult").textContent = `已重写 ${bad.length} 条设定，剩余不符 ${countBad()} 条。地图没有改动。`;
    addTrace({ kind: "lore", title: "设定服从地图", body: `重写了 ${bad.length} 条过期设定。` });
  } catch (e) { $("#editResult").textContent = "中断：" + (e.message || e); }
  finally { bumpLore(); setBusy(false); refreshAll(); }
}
async function obeyLore() {
  const sn = last(); if (!sn || !S.lore || S.running) return;
  S.ctl = new AbortController(); setBusy(true, "修正地图中");
  try {
    const before = countBad();
    const W = await repairLoop(sn.W, { fb: "structured", maxIter: 4, withLore: true, eng: engine(), title: "服从设定" });
    claimStatuses(W);
    const left = countBad();
    $("#editResult").textContent = `地图修正后，不符的设定从 ${before} 条变为 ${left} 条。${left ? "剩下的（路程、方位、地貌等）无法靠移动聚落解决，可以改用“重写过期设定”。" : ""}`;
  } catch (e) { $("#editResult").textContent = "中断：" + (e.message || e); }
  finally { bumpLore(); setBusy(false); refreshAll(); }
}

// ---------- local edits ----------
function fillEditSelects() {
  const sel = $("#editS"); sel.innerHTML = "";
  for (const s of S.spec.settlements) sel.add(new Option(`${s.name}（${TYPE_ZH[s.type]}）`, s.id));
}
function updateEditButtons() {
  const has = !!last();
  $("#moveBtn").disabled = S.running || !has || !S.spec.settlements.length;
  $("#ridgeBtn").disabled = S.running || !has;
  $("#loreBtn").disabled = S.running || !has || !S.spec.settlements.length;
  const hasLore = !!(S.lore && S.lore.length);
  $("#rewriteBtn").disabled = S.running || !hasLore;
  $("#obeyBtn").disabled = S.running || !hasLore;
}
function afterEdit(W0, r, label, what) {
  const W = r.W;
  let same = 0, riverDiff = 0;
  for (let i = 0; i < NN; i++) { if (Math.abs(W.h[i] - W0.h[i]) < 1e-6) same++; if ((W.hy.channel[i] && !W.hy.lake[i]) !== (W0.hy.channel[i] && !W0.hy.lake[i])) riverDiff++; }
  const staleBefore = (S.lore || []).reduce((a, e) => a + e.claims.filter(c => c.status === "stale").length, 0);
  claimStatuses(W); bumpLore();
  const staleAfter = (S.lore || []).reduce((a, e) => a + e.claims.filter(c => c.status === "stale").length, 0);
  pushSnap(W, label, "edit");
  const rep = reportOf(last());
  const msg = `${r.results.map(x => x.msg).join("；")}。地形未改动的格子 ${(same / NN * 100).toFixed(1)}%，河道变化 ${riverDiff} 格；${S.lore ? `新增过期声明 ${Math.max(0, staleAfter - staleBefore)} 条；` : ""}当前违规 ${rep.fails.length} 项。`;
  $("#editResult").textContent = msg;
  addTrace({ kind: "edit", title: "用户编辑", body: `${what}。${msg}` });
}
function editMove() {
  const sn = last(); if (!sn || S.running) return;
  const id = $("#editS").value, reg = $("#editR").value;
  const r = applyActions(sn.W, [{ tool: "move_settlement", args: { id, targets: ["region:" + reg] } }]);
  afterEdit(sn.W, r, "编辑", `把${nameOf(sn.W, id)}移到${REGION_ZH[reg]}部`);
}
function editRidge() {
  const sn = last(); if (!sn || S.running) return;
  const reg = $("#ridgeR").value;
  const r = applyActions(sn.W, [{ tool: "raise_ridge", args: { region: reg, amount: 0.15 } }]);
  afterEdit(sn.W, r, "编辑", `在${REGION_ZH[reg]}部隆起山脊`);
}

// ---------- rendering: side panels ----------
function renderScrub() {
  const el = $("#scrub");
  el.innerHTML = S.snaps.map((s, k) => `<button type="button" data-k="${k}" aria-pressed="${k === S.cur}" class="snap ${s.kind}"><span>${esc(s.label)}</span><b>${reportOf(s).fails.length}</b></button>`).join("");
  el.querySelectorAll("button").forEach(b => b.onclick = () => { S.cur = +b.dataset.k; S.focus = null; renderScrub(); renderMap(); renderChecks(); renderCity(); });
  $("#histNote").hidden = S.cur === S.snaps.length - 1 || !S.snaps.length;
}
function renderMetrics() {
  const el = $("#metrics");
  if (!S.snaps.length) { el.innerHTML = ""; return; }
  const traj = S.snaps.filter(s => s.kind !== "edit").map(s => reportOf(s).fails.length);
  const rep = reportOf(last());
  const declared = rep.checks.filter(c => c.status === "declared").length;
  el.innerHTML = `
    <div><dt>违规数变化</dt><dd>${traj.join(" → ")}</dd></div>
    <div><dt>检查通过率</dt><dd>${(rep.rate * 100).toFixed(0)}%</dd></div>
    <div><dt>声明无法满足</dt><dd>${declared}</dd></div>
    <div><dt>Claude 调用</dt><dd>${S.llmCalls} 次</dd></div>
    <div><dt>用时</dt><dd>${S.elapsed ? S.elapsed.toFixed(1) + " s" : "…"}</dd></div>`;
}
function renderTrace() {
  const el = $("#trace");
  el.innerHTML = S.trace.map(t => `
    <li class="tr ${t.kind}">
      <div class="tr-head"><span class="tr-title">${esc(t.title)}</span>${t.before != null ? `<span class="tr-count">${t.before} → ${t.after ?? "…"}</span>` : ""}${t.llm ? `<span class="tr-llm">Claude ${t.llm}</span>` : ""}</div>
      ${t.body ? `<p>${esc(t.body)}</p>` : ""}
      ${t.pending ? `<p class="pending">${esc(t.pending)}</p>` : ""}
      ${t.actions ? `<ul class="acts">${t.actions.map(a => `<li class="${a.ok ? "" : "bad"}"><code>${esc(a.call)}</code><span>${esc(a.msg)}</span></li>`).join("")}</ul>` : ""}
    </li>`).join("");
  el.scrollTop = el.scrollHeight;
  if (S.loreItem && S.loreItem.pending) { const p = $("#loreLog .pending"); if (p) p.textContent = S.loreItem.pending; else $("#loreLog").insertAdjacentHTML("beforeend", `<li class="pending">${esc(S.loreItem.pending)}</li>`); }
}
function renderChecks() {
  const el = $("#checks"); const sn = curSnap();
  if (!sn) { el.innerHTML = ""; return; }
  const rep = reportOf(sn);
  const fails = rep.fails, declared = rep.checks.filter(c => c.status === "declared"), pass = rep.checks.filter(c => c.status === "pass");
  const item = (c, n) => `<li class="ck ${c.status}${S.focus === c.id ? " focus" : ""}" data-id="${esc(c.id)}" tabindex="0">
      <span class="ck-n">${n ?? ""}</span><span class="ck-cat">${esc(c.cat)}</span>
      <span class="ck-body"><span class="ck-label">${esc(c.label)}</span><span class="ck-meas">${esc(c.measured)}</span></span></li>`;
  el.innerHTML = `
    <p class="ck-sum">${sn.label}：${rep.checks.length} 项检查，<b class="f">${fails.length} 项违规</b>${declared.length ? `，${declared.length} 项已声明无法满足` : ""}</p>
    <ol class="ck-list">${fails.map((c, k) => item(c, k + 1)).join("")}${declared.map(c => item(c, "×")).join("")}</ol>
    <details><summary>${pass.length} 项通过</summary><ol class="ck-list">${pass.map(c => item(c, "")).join("")}</ol></details>`;
  el.querySelectorAll(".ck").forEach(li => {
    const f = () => { S.focus = S.focus === li.dataset.id ? null : li.dataset.id; renderChecks(); renderMap(); };
    li.onclick = f; li.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); f(); } };
  });
}
function renderLore() {
  const el = $("#lore");
  if (!S.lore) { el.innerHTML = `<p class="empty">生成并修正地图后，点“生成世界观”。每条设定里的地理描述都会被逐条对照地图核查。</p>`; return; }
  const W = last().W;
  el.innerHTML = S.lore.map(e => `
    <article class="card" data-subject="${esc(e.subject)}">
      <h3>${esc(e.title)}</h3>
      <p class="lore-text">${esc(e.text).replace(/\[\[([A-Za-z]\d+)\]\]/g, (m, id) => `<span class="ent" data-id="${id}">${esc(nameOf(W, id))}</span>`)}</p>
      <ul class="claims">${e.claims.map(c => {
        const r = c.result || checkClaim(W, c);
        const st = c.status || (r.ok ? "ok" : "false");
        const tag = st === "ok" ? "符合" : st === "stale" ? "过期" : "不符";
        return `<li class="cl ${st}"><span class="cl-tag">${tag}</span><span>${esc(r.label)}${st !== "ok" ? `<em>${esc(r.measured)}</em>` : ""}</span></li>`;
      }).join("")}</ul>
    </article>`).join("");
  el.querySelectorAll(".ent, .card").forEach(n => {
    n.addEventListener("mouseenter", () => { S.highlight = n.dataset.id || n.dataset.subject; renderMap(); });
    n.addEventListener("mouseleave", () => { S.highlight = null; renderMap(); });
  });
}

// ---------- batch experiments (group A: same WorldSpec, agent vs rule baseline) ----------
// Run from the browser console:  runBatch({n: 12, policy: "llm", feedback: "structured"})
async function runBatch(opts = {}) {
  const { n = 12, policy = "llm", feedback = "structured", maxIter = 6, offset = 0 } = opts;
  if (policy === "llm" && !S.sample) { console.warn("Claude 不可用，无法跑 LLM 组"); return; }
  S.ctl = new AbortController();
  const trials = makeTestSet(n + offset).slice(offset);
  const rows = [];
  const label = policy === "llm" ? `llm-${feedback}-${$("#tier").value}` : `rule-${feedback}`;
  const fn = policy === "llm"
    ? async (W, rep, hist) => { const p = await llmRepair(W, rep, hist, feedback, {}); return p; }
    : SCRIPTED[feedback === "binary" ? "binary" : feedback === "none" ? "none" : "structured"](label).fn;
  for (const t of trials) {
    S.llmCalls = 0;
    const t0 = performance.now();
    const { rec } = await runTrial(t, fn, { maxIter, label });
    rec.llm_calls = S.llmCalls; rec.wall_ms = Math.round(performance.now() - t0);
    rows.push(rec);
    console.log(`${rows.length}/${trials.length}`, rec.trial, rec.cat, rec.traj, rec.stopped, `${(rec.wall_ms / 1000).toFixed(1)}s`);
    window.__batchRows = rows;
  }
  console.table(summarise(rows));
  downloadCSV(`${label}.csv`, toCSV(rows));
  return rows;
}
// group B: free-text description -> WorldSpec, which the rule baseline cannot do at all
async function runExtraction(cases) {
  if (!S.sample) { console.warn("Claude 不可用"); return; }
  S.ctl = new AbortController();
  const rows = [];
  for (const c of cases || PRESETS.map(p => ({ id: p.key, text: p.text, gold: normalizeSpec(p.spec) }))) {
    let got = null, err = "";
    try { got = normalizeSpec(await llmPlan(c.text, {})); } catch (e) { err = e.message || String(e); }
    rows.push({ case: c.id, err, ...(got ? compareSpecs(c.gold, got) : {}) });
    console.log(rows[rows.length - 1]);
  }
  console.table(rows);
  downloadCSV("extraction.csv", toCSV(rows));
  return rows;
}
// crude field-level agreement between a gold WorldSpec and an extracted one
function compareSpecs(gold, got) {
  const setOf = ss => new Set(ss.map(s => `${s.type}|${s.region}|${[...s.requires].sort().join("+")}`));
  const g = setOf(gold.settlements), h = setOf(got.settlements);
  const inter = [...h].filter(x => g.has(x)).length;
  return {
    ocean_side: gold.ocean_side === got.ocean_side ? 1 : 0,
    wind_from: gold.wind_from === got.wind_from ? 1 : 0,
    n_mountains: got.mountains.length, gold_mountains: gold.mountains.length,
    mountain_region_hits: got.mountains.filter(m => gold.mountains.some(q => q.region === m.region)).length,
    n_settlements: got.settlements.length, gold_settlements: gold.settlements.length,
    settlement_precision: +(inter / Math.max(1, h.size)).toFixed(2),
    settlement_recall: +(inter / Math.max(1, g.size)).toFixed(2),
    min_rivers_match: gold.min_major_rivers === got.min_major_rivers ? 1 : 0,
  };
}
function downloadCSV(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------- settlement plans (generated in the background) ----------
function plansReady(W) { return !!(W._roads && W._plans && W.spec.settlements.every(s => W._plans[s.id])); }
function schedulePlans(W) {
  if (plansReady(W) || W._planJob) return;
  W._planJob = true;
  const todo = W.spec.settlements.slice();
  const step = () => {
    if (!W._roads) buildRoads(W);
    else { const s = todo.shift(); if (s) cityPlan(W, s); }
    if (todo.length || !W._roads) { setTimeout(step, 0); return; }
    W._planJob = false;
    const sn = curSnap();
    if (sn && sn.W === W) { renderMap(); renderCity(); }
  };
  setTimeout(step, 30);
}
function selectCity(sid) { S.city = sid; renderCity(); if (S.view === "2d") renderMap(); else if (V3.ok) { V3.dirty = true; buildMarkers3D(curSnap()); } }
function renderCity() {
  const sn = curSnap(), tabs = $("#cityTabs"), cv = $("#cityCanvas");
  if (!sn) { tabs.innerHTML = ""; return; }
  const W = sn.W, list = W.spec.settlements;
  if (!list.length) { tabs.innerHTML = `<p class="empty">这个区域没有聚落。</p>`; return; }
  if (!list.some(s => s.id === S.city)) S.city = (list.find(s => s.type === "city") || list.find(s => s.type === "port") || list[0]).id;
  tabs.innerHTML = list.map(s => `<button type="button" data-sid="${s.id}" aria-pressed="${s.id === S.city}">${esc(s.name)}<small>${TYPE_ZH[s.type]}</small></button>`).join("");
  tabs.querySelectorAll("button").forEach(b => b.onclick = () => selectCity(b.dataset.sid));
  const s = list.find(q => q.id === S.city);
  $("#cityTitle").textContent = s.name;
  const reg = REGION_ZH[regionOf(...W.P.pos[s.id])];
  if (!plansReady(W)) { $("#citySub").textContent = "正在生成城市规划…"; const ctx = cv.getContext("2d"); ctx.clearRect(0, 0, cv.width, cv.height); $("#cityLegend").innerHTML = ""; $("#cityLandmarks").innerHTML = ""; schedulePlans(W); return; }
  const P = cityPlan(W, s);
  const f = settlementFacts(W, s);
  $("#citySub").textContent = `${TYPE_ZH[s.type]}，位于${reg}部，${BIOME_ZH[f.biome]}${f.coastal ? "，临海" : ""}${f.river ? `，${nameOf(W, f.river)}流经` : ""}。图示范围约 ${Math.round(P.EXT * 2.7 * KM_PER_CELL)} km 见方，城镇按示意比例放大。`;
  drawCityDetail(W, P);
  const total = Object.values(P.zoneCells).reduce((a, b) => a + b, 0) || 1;
  const zones = Object.entries(P.zoneCells).sort((a, b) => b[1] - a[1]);
  $("#cityLegend").innerHTML = zones.map(([z, n]) => `<li data-zone="${z}"><span class="sw" style="background:${ZONES[z].block || ZONES[z].ground}"></span>${ZONES[z].zh}<b>${Math.round(n / total * 100)}%</b></li>`).join("")
    + `<li data-zone="road"><span class="sw road"></span>主干道与环路</li>` + (P.walls.length ? `<li><span class="sw wall"></span>城墙</li>` : "");
  $("#cityLegend").querySelectorAll("li[data-zone]").forEach(li => {
    li.onmouseenter = () => { S.cityZoneHl = li.dataset.zone === "road" ? null : li.dataset.zone; drawCityDetail(W, P); };
    li.onmouseleave = () => { S.cityZoneHl = null; drawCityDetail(W, P); };
  });
  const counts = {}; for (const L of P.landmarks) counts[L.kind] = (counts[L.kind] || 0) + 1;
  $("#cityLandmarks").innerHTML = Object.entries(counts).map(([k, n]) => `<li><span class="ic">${LANDMARK[k].icon}</span>${LANDMARK[k].zh}${n > 1 ? ` ×${n}` : ""}</li>`).join("")
    + `<li class="meta">${P.blocks.length} 个街区，${P.buildings.length} 栋建筑</li>`;
}
function drawCityDetail(W, P) {
  const cv = $("#cityCanvas"), ctx = cv.getContext("2d"), SZ = cv.width;
  const view = P.EXT * 1.35, k = SZ / (2 * view);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, SZ, SZ);
  const sn = curSnap();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(baseImage(sn, "2d"), P.CX - view, P.CY - view, 2 * view, 2 * view, 0, 0, SZ, SZ);
  ctx.fillStyle = "rgba(245,244,238,0.18)"; ctx.fillRect(0, 0, SZ, SZ);
  if (!P._viewWater) P._viewWater = viewWaterCanvas(W, P.CX - view, P.CY - view, 2 * view, 420);
  ctx.drawImage(P._viewWater, 0, 0, SZ, SZ);
  // regional context: rivers, fields, roads leading out
  ctx.save(); ctx.setTransform(k, 0, 0, k, SZ / 2 - P.CX * k, SZ / 2 - P.CY * k);
  ctx.save(); ctx.translate(P.CX, P.CY); drawFields(ctx, P); ctx.restore();
  for (const rd of buildRoads(W)) {
    if (rd.a !== P.id && rd.b !== P.id && !rd.pts.some(([x, y]) => Math.abs(x - P.CX) < view && Math.abs(y - P.CY) < view)) continue;
    for (const [col, w] of [["rgba(90,70,40,0.6)", 0.34], [rd.major ? "#f7e7a8" : "#f4efe2", 0.24]]) {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); rd.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    }
  }
  ctx.translate(P.CX, P.CY);
  drawPlan(ctx, W, P, { unitPx: k, hlZone: S.cityZoneHl });
  ctx.restore();
  // landmark labels
  const toPx = (u, v) => [SZ / 2 + u * k, SZ / 2 + v * k];
  const placed = [];
  for (const L of P.landmarks) {
    const [x, y] = toPx(L.u, L.v);
    const label = LANDMARK[L.kind].zh;
    let ly = y - L.h * k / 2 - 12;
    while (placed.some(p => Math.abs(p[0] - x) < 60 && Math.abs(p[1] - ly) < 16)) ly -= 16;
    placed.push([x, ly]);
    ctx.fillStyle = "rgba(31,43,46,0.85)"; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill();
    if (ly < y - L.h * k / 2 - 13) { ctx.strokeStyle = "rgba(31,43,46,0.5)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, ly + 6); ctx.stroke(); }
    halo(ctx, `${LANDMARK[L.kind].icon} ${label}`, x, ly, `600 13px ${SANS}`, INK, "center");
  }
  halo(ctx, P.name, 16, 24, `700 24px ${SERIF}`, INK, "left");
  // scale bar
  const bar = 10 / KM_PER_CELL * k; ctx.fillStyle = INK; ctx.fillRect(SZ - 24 - bar, SZ - 24, bar, 4);
  halo(ctx, "10 km（示意）", SZ - 24 - bar / 2, SZ - 36, `500 12px ${SANS}`, INK, "center");
}

// ---------- rendering: map ----------
const BIOME_RGB = {
  snow: [240, 241, 238], rock: [150, 140, 128], tundra: [176, 178, 150], taiga: [86, 116, 88], steppe: [198, 186, 128],
  desert: [220, 196, 142], grassland: [158, 182, 108], forest: [100, 138, 78], marsh: [104, 134, 110], rainforest: [66, 112, 74],
};
function hyps(rel) {
  const stops = [[0, [120, 158, 104]], [0.1, [170, 186, 124]], [0.2, [204, 192, 134]], [0.3, [186, 150, 104]], [0.4, [140, 116, 96]], [0.5, [236, 234, 228]]];
  for (let k = 1; k < stops.length; k++) if (rel <= stops[k][0]) { const [a, ca] = stops[k - 1], [b, cb] = stops[k]; const t = (rel - a) / (b - a); return ca.map((v, j) => v + (cb[j] - v) * t); }
  return stops[stops.length - 1][1];
}
function boxBlur(src, r) {
  const t = new Float32Array(NN), o = new Float32Array(NN);
  for (let y = 0; y < N; y++) { let acc = 0, c = 0; for (let x = -r; x < N + r; x++) { const a = x + r, b = x - r - 1; if (a >= 0 && a < N) { acc += src[y * N + a]; c++; } if (b >= 0 && b < N) { acc -= src[y * N + b]; c--; } if (x >= 0 && x < N) t[y * N + x] = acc / c; } }
  for (let x = 0; x < N; x++) { let acc = 0, c = 0; for (let y = -r; y < N + r; y++) { const a = y + r, b = y - r - 1; if (a >= 0 && a < N) { acc += t[a * N + x]; c++; } if (b >= 0 && b < N) { acc -= t[b * N + x]; c--; } if (y >= 0 && y < N) o[y * N + x] = acc / c; } }
  return o;
}
// relief shading: multi-directional hillshade + cast shadows + ambient occlusion
function shading(W) {
  if (W._shade) return W._shade;
  const Z = 70, sea = W.P.sea, H = new Float32Array(NN);
  for (let i = 0; i < NN; i++) H[i] = W.ocean[i] ? 0 : W.hy.lake[i] ? (W.hy.surf[i] - sea) * Z : Math.max(0, W.h[i] - sea) * Z;
  const hill = new Float32Array(NN);
  const L = [[-1, -1, 0.62, 0.70], [-1, 0.3, 0.2, 0.9], [0.2, -1, 0.18, 0.9]]; // dir to light (x,y), weight, altitude
  const lights = L.map(([lx, ly, w, alt]) => { const d = Math.hypot(lx, ly); return [lx / d * Math.cos(alt), ly / d * Math.cos(alt), Math.sin(alt), w]; });
  const norm = lights.reduce((a, l) => a + l[3] * l[2], 0);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const gx = (H[y * N + Math.min(N - 1, x + 1)] - H[y * N + Math.max(0, x - 1)]) / 2;
    const gy = (H[Math.min(N - 1, y + 1) * N + x] - H[Math.max(0, y - 1) * N + x]) / 2;
    const l = Math.hypot(gx, gy, 1), nx = -gx / l, ny = -gy / l, nz = 1 / l;
    let v = 0; for (const [a, b, c, w] of lights) v += w * Math.max(0, nx * a + ny * b + nz * c);
    hill[i] = v / norm;
  }
  // cast shadows from the NW sun (altitude ~28°)
  const hor = new Float32Array(NN), sh = new Float32Array(NN), drop = Math.tan(0.49) * 1.414;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (x > 0 && y > 0) { const j = i - N - 1; hor[i] = Math.max(H[j], hor[j]) - drop; } else hor[i] = 0;
    sh[i] = clamp((hor[i] - H[i]) / 2.5, 0, 1);
  }
  const shadow = boxBlur(sh, 1);
  const blur = boxBlur(H, 7), ao = new Float32Array(NN);
  for (let i = 0; i < NN; i++) ao[i] = clamp(1 - (blur[i] - H[i]) * 0.045, 0.72, 1.08);
  const dLand = distField(i => !W.ocean[i]);
  W._shade = { hill, shadow, ao, dLand };
  return W._shade;
}
function baseImage(sn, mode = "2d") {
  const key = mode + S.layers.base;
  sn.bases = sn.bases || {};
  if (sn.bases[key]) return sn.bases[key];
  const W = sn.W, off = document.createElement("canvas"); off.width = off.height = N;
  const { hill, shadow, ao, dLand } = shading(W);
  const ctx = off.getContext("2d"), img = ctx.createImageData(N, N), d = img.data;
  const tex = mode === "tex";
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x; let c;
    const grain = 1 + (((x * 73856093) ^ (y * 19349663)) % 7) * 0.004;
    if (W.ocean[i]) {
      const depth = clamp((W.P.sea - W.h[i]) / 0.32, 0, 1), near = smooth(0, 14, dLand[i]);
      const t = clamp(0.35 * depth + 0.65 * near, 0, 1);
      c = [150 - 100 * t, 198 - 98 * t, 200 - 72 * t];
      if (dLand[i] <= 1.5) c = c.map(v => v + 26);
      if (!tex) c = c.map(v => v * (1 - 0.25 * shadow[i]));
    } else if (W.hy.lake[i]) {
      const dep = clamp((W.hy.surf[i] - W.h[i]) / 0.08, 0, 1);
      c = [128 - 50 * dep, 176 - 44 * dep, 186 - 26 * dep];
      if (!tex) c = c.map(v => v * (1 - 0.25 * shadow[i]));
    } else {
      c = S.layers.base === "biome" ? BIOME_RGB[W.biome[i]] : hyps(W.h[i] - W.P.sea);
      if (S.layers.base === "biome") { const rel = W.h[i] - W.P.sea; c = c.map(v => v * (0.92 + rel * 0.3)); }
      const lit = tex ? (0.82 + 0.22 * hill[i]) * ao[i] : (0.42 + 0.66 * hill[i]) * (1 - 0.38 * shadow[i]) * ao[i];
      c = c.map(v => v * lit * grain);
    }
    const o = i * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  sn.bases[key] = off;
  return off;
}
function riverLabelCells(W) {
  if (W._rl) return W._rl;
  const by = new Map();
  for (let i = 0; i < NN; i++) if (W.hy.channel[i] && !W.hy.lake[i]) { const r = W.hy.riverOfSys.get(W.hy.sys[i]); if (r) { if (!by.has(r.id)) by.set(r.id, []); by.get(r.id).push(i); } }
  W._rl = W.hy.rivers.map(r => { const cells = (by.get(r.id) || []).sort((a, b) => W.hy.acc[a] - W.hy.acc[b]); return cells.length ? { r, i: cells[Math.floor(cells.length * 0.55)] } : null; }).filter(Boolean);
  return W._rl;
}
function drawRivers(ctx, W, k, wmul = 1) {
  const thr = W.P.riverThr, buckets = [[], [], [], [], [], []];
  for (let i = 0; i < NN; i++) {
    if (!W.hy.channel[i] || W.hy.lake[i]) continue; const d = W.hy.down[i]; if (d < 0) continue;
    buckets[clamp(Math.floor(Math.log2(W.hy.acc[i] / thr)), 0, 5)].push(i, d);
  }
  const c = i => [(i % N + 0.5) * k, (Math.floor(i / N) + 0.5) * k];
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  buckets.forEach((arr, b) => {
    const w = (0.45 + b * 0.5) * wmul;
    for (const [col, extra] of (b >= 2 ? [["rgba(28,58,74,0.28)", 0.9 * wmul], ["#4a86a2", 0]] : [["#5b93ad", 0]])) {
      ctx.strokeStyle = col; ctx.lineWidth = w + extra; ctx.beginPath();
      for (let j = 0; j < arr.length; j += 2) { const [x1, y1] = c(arr[j]), [x2, y2] = c(arr[j + 1]); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
      ctx.stroke();
    }
  });
}
const INK = "#1f2b2e", FLAG = "#b4235f", LORE = "#a06c10";
function halo(ctx, text, x, y, font, color, align = "left") {
  ctx.font = font; ctx.textAlign = align; ctx.textBaseline = "middle";
  ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(244,246,240,0.9)"; ctx.lineJoin = "round"; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function renderMap() {
  if (S.view === "3d" && V3 && V3.ok) { update3D(); return; }
  if (S.view === "game" && V3 && V3.ok) { renderGameMap(); return; }
  render2D();
}
function render2D() {
  const cv = $("#map"), ctx = cv.getContext("2d"), SZ = cv.width, k = SZ / N;
  const sn = curSnap();
  ctx.clearRect(0, 0, SZ, SZ);
  if (!sn) { ctx.fillStyle = "#dfe4de"; ctx.fillRect(0, 0, SZ, SZ); halo(ctx, "地图会显示在这里", SZ / 2, SZ / 2, `500 24px ${SERIF}`, INK, "center"); return; }
  const W = sn.W;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(baseImage(sn, "2d"), 0, 0, SZ, SZ);
  const c = i => [(i % N + 0.5) * k, (Math.floor(i / N) + 0.5) * k];
  if (S.layers.grid) {
    ctx.save(); ctx.strokeStyle = "rgba(31,43,46,0.35)"; ctx.setLineDash([6, 6]); ctx.lineWidth = 1;
    for (const t of [1, 2]) { ctx.beginPath(); ctx.moveTo(t * SZ / 3, 0); ctx.lineTo(t * SZ / 3, SZ); ctx.moveTo(0, t * SZ / 3); ctx.lineTo(SZ, t * SZ / 3); ctx.stroke(); }
    ctx.restore();
    REGIONS.forEach((r, j) => halo(ctx, REGION_ZH[r], (j % 3) * SZ / 3 + 8, Math.floor(j / 3) * SZ / 3 + 14, `500 12px ${SANS}`, "rgba(31,43,46,0.6)"));
    // scale bar
    const px = 200 / KM_PER_CELL * k; ctx.fillStyle = INK; ctx.fillRect(SZ - 24 - px, SZ - 22, px, 4);
    halo(ctx, "200 km", SZ - 24 - px / 2, SZ - 34, `500 12px ${SANS}`, INK, "center");
  }
  if (S.layers.rivers) {
    drawRivers(ctx, W, k, 1);
    for (const { r, i } of riverLabelCells(W)) { const [x, y] = c(i); halo(ctx, r.name, x + 6, y - 8, `italic 500 13px ${SERIF}`, S.highlight === r.id ? LORE : "#2f5c75"); }
    for (const l of W.hy.lakes.slice(0, 5)) halo(ctx, l.name, (l.cx + 0.5) * k, (l.cy + 0.5) * k, `italic 500 12px ${SERIF}`, "#2f5c75", "center");
    if (W.P.hydro !== "filled") { ctx.fillStyle = "#2f5c75"; for (const s of W.hy.sinks) { const [x, y] = c(s.i); ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 7); ctx.fill(); } }
  }
  for (const { m, cell } of mountainPeaks(W)) {
    const x = (cell[0] + 0.5) * k, y = (cell[1] + 0.5) * k, hl = S.highlight === m.id;
    ctx.fillStyle = hl ? LORE : INK; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y + 3); ctx.lineTo(x - 5, y + 3); ctx.closePath(); ctx.fill();
    halo(ctx, m.name, x, y + 16, `600 16px ${SERIF}`, hl ? LORE : INK, "center");
  }
  const ready = plansReady(W);
  if (!ready) schedulePlans(W);
  if (S.layers.settle && ready) {
    drawRegionalOverlay(ctx, W, k);
    for (const s of W.spec.settlements) {
      const P = cityPlan(W, s), x = P.CX * k, y = P.CY * k, hl = S.highlight === s.id || S.city === s.id;
      if (hl) { ctx.strokeStyle = S.highlight === s.id ? LORE : "rgba(31,43,46,0.7)"; ctx.lineWidth = 2; ctx.setLineDash(S.highlight === s.id ? [] : [4, 3]); ctx.beginPath(); ctx.arc(x, y, P.R * k + 4, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      halo(ctx, s.name, x, y - P.R * k * 0.9 - 8, `700 ${s.type === "city" || s.type === "port" ? 16 : 13}px ${SERIF}`, S.highlight === s.id ? LORE : INK, "center");
    }
  }
  if (S.layers.settle && !ready) for (const s of W.spec.settlements) {
    const [px, py] = W.P.pos[s.id]; const x = (px + 0.5) * k, y = (py + 0.5) * k;
    const hl = S.highlight === s.id;
    if (hl) { ctx.strokeStyle = LORE; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 15, 0, 7); ctx.stroke(); }
    ctx.fillStyle = "#f4f6f0"; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath();
    if (s.type === "fortress") ctx.rect(x - 5.5, y - 5.5, 11, 11);
    else ctx.arc(x, y, s.type === "city" ? 7 : s.type === "town" || s.type === "port" ? 5.5 : 4, 0, 7);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK;
    if (s.type === "city") { ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); }
    if (s.type === "port") { ctx.beginPath(); ctx.moveTo(x, y - 3.5); ctx.lineTo(x, y + 3.5); ctx.moveTo(x - 3, y + 1); ctx.quadraticCurveTo(x, y + 5, x + 3, y + 1); ctx.lineWidth = 1.4; ctx.stroke(); }
    halo(ctx, s.name, x + 10, y, `600 ${s.type === "city" || s.type === "port" ? 15 : 13}px ${SERIF}`, hl ? LORE : INK);
  }
  if (S.layers.marks) {
    const rep = reportOf(sn);
    const draw = (cc, n, style) => {
      for (const p of cc.at || []) {
        const x = (p[0] + 0.5) * k, y = (p[1] + 0.5) * k, focus = S.focus === cc.id;
        ctx.save();
        ctx.strokeStyle = style === "declared" ? "rgba(31,43,46,0.55)" : FLAG; ctx.lineWidth = focus ? 4 : 2.2;
        if (style === "declared") ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.arc(x, y, focus ? 20 : 13, 0, 7); ctx.stroke();
        ctx.restore();
        const bx = x + 11, by = y - 12;
        ctx.fillStyle = style === "declared" ? "#56666a" : FLAG; ctx.beginPath(); ctx.arc(bx, by, 8, 0, 7); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = `600 10px ${SANS}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(n), bx, by + 0.5);
      }
    };
    rep.checks.filter(x => x.status === "declared").forEach(x => draw(x, "×", "declared"));
    rep.fails.forEach((x, j) => draw(x, j + 1, "fail"));
  }
}
const SERIF = `"Noto Serif SC", "Songti SC", "STSong", serif`;
const SANS = `"IBM Plex Sans", "PingFang SC", "Microsoft YaHei", sans-serif`;

// ---------- boot ----------
initControls();
setViewMode(window.THREE ? "3d" : "2d");
renderLore(); updateEditButtonsSafe();
function updateEditButtonsSafe() { S.spec = S.spec || { settlements: [] }; updateEditButtons(); }
(document.fonts ? document.fonts.ready : Promise.resolve()).then(() => runAgent());
