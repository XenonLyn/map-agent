// Verifier reliability: inject known faults into repaired worlds and check the verifier flags them.
// Usage: node tests/injection.js [nTrials]  -> writes results/injection.csv
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = f => fs.readFileSync(path.join(__dirname, "../src", f), "utf8").replace(/if \(typeof module[^\n]*\n/, "");
const ctx = { console, JSON, Math, Date }; vm.createContext(ctx);
vm.runInContext(src("core.js") + src("presets.js") + src("bench.js") + "\nthis.SCRIPTED = SCRIPTED;", ctx, { filename: "bundle.js" });
const trials = ctx.makeTestSet(+(process.argv[2] || 12));
const rows = ctx.injectionTest(trials);
const dir = path.join(__dirname, "../results"); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "injection.csv"), ctx.toCSV(rows));
const by = {};
for (const r of rows) { const b = by[r.injection] = by[r.injection] || { n: 0, hit: 0, extra: 0 }; b.n++; b.hit += r.detected; b.extra += r.extra_codes ? 1 : 0; }
console.table(Object.entries(by).map(([k, v]) => ({ injection: k, n: v.n, recall: +(v.hit / v.n).toFixed(2), with_side_effects: +(v.extra / v.n).toFixed(2) })));
console.log("clean base worlds:", rows.filter(r => r.base_clean).length, "/", rows.length);
