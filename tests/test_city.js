// Runs the scripted agent on every preset, then times road + city-plan generation (no browser needed).
const vm = require('vm'); const fs = require('fs'); const path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
const code = src('core.js').replace(/if \(typeof module[^\n]*\n/,'') + src('presets.js').replace(/if \(typeof module[^\n]*\n/,'') + src('city.js');
const ctx = { console, Math, JSON, performance: { now: () => Date.now() } }; vm.createContext(ctx);
vm.runInContext(code + `
this.run = function(k) {
  const spec = normalizeSpec(PRESETS[k].spec);
  let W = derive(spec, initParams(spec)); let rep = verify(W); const hist = [];
  for (let it = 0; it < 6 && rep.fails.length; it++) { const pol = scriptedStructured(W, rep, hist); const r = applyActions(W, pol.actions); hist.push(r); W = r.W; rep = verify(W); }
  let t = Date.now(); const roads = buildRoads(W); const tr = Date.now() - t;
  const out = { preset: PRESETS[k].key, roads: roads.length, roadMs: tr, plans: [] };
  for (const s of W.spec.settlements) { t = Date.now(); const P = cityPlan(W, s);
    out.plans.push([s.name, s.type, Date.now() - t + 'ms', 'mains', P.mains.length, 'rings', P.rings.length, 'blk', P.blocks.length, 'bld', P.buildings.length, 'lm', P.landmarks.map(l=>l.kind).join('/'), 'zones', JSON.stringify(P.zoneCells), 'fields', P.fields.length]); }
  return out;
};`, ctx);
for (const k of [0,1,2,3]) { const o = ctx.run(k); console.log(o.preset, 'roads', o.roads, o.roadMs+'ms'); o.plans.forEach(p => console.log('  ', p.join(' '))); }
