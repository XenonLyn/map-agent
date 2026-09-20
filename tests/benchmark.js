// Batch benchmark of the scripted policies (the baseline) across a generated test set.
// Usage: node tests/benchmark.js [nTrials] [maxIter]   -> writes results/baseline.csv and prints a summary
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = f => fs.readFileSync(path.join(__dirname, "../src", f), "utf8").replace(/if \(typeof module[^\n]*\n/, "");
const ctx = { console, JSON, Math, Date, performance: { now: () => Date.now() } };
vm.createContext(ctx);
vm.runInContext(src("core.js") + src("presets.js") + src("bench.js") + "\nthis.SCRIPTED = SCRIPTED;", ctx, { filename: "bundle.js" });

// args: nTrials maxIter [condition] [from] [to]   — appends to results/baseline.csv so long runs can be chunked
const N_TRIALS = +(process.argv[2] || 48), MAX_ITER = +(process.argv[3] || 6);
const ONLY = process.argv[4] || "", FROM = +(process.argv[5] || 0), TO = +(process.argv[6] || N_TRIALS);
(async () => {
  const trials = ctx.makeTestSet(N_TRIALS);
  const dir = path.join(__dirname, "../results"); fs.mkdirSync(dir, { recursive: true });
  const csv = path.join(dir, "baseline.csv");
  const rows = [];
  const append = r => {
    const exists = fs.existsSync(csv);
    const line = ctx.toCSV([r]).split("\n");
    fs.appendFileSync(csv, (exists ? "" : line[0] + "\n") + line[1] + "\n");
  };
  for (const [cond, mk] of Object.entries(ctx.SCRIPTED)) {
    if (ONLY && cond !== ONLY) continue;
    const pol = mk("rule-" + cond);
    for (const t of trials.slice(FROM, TO)) {
      const { rec } = await ctx.runTrial(t, pol.fn, { maxIter: MAX_ITER, label: pol.label });
      rows.push(rec); append(rec);
      process.stdout.write(`${rows.length} ${rec.trial} ${rec.policy} ${rec.cat} ${rec.traj} ${rec.stopped}\n`);
    }
  }
  const all = fs.readFileSync(csv, "utf8").trim().split("\n");
  const cols = all[0].split(",");
  const parsed = all.slice(1).map(l => { const v = l.split(","); const o = {}; cols.forEach((c, i) => o[c] = isNaN(+v[i]) || v[i] === "" ? v[i] : +v[i]); return o; });
  const sum = ctx.summarise(parsed);
  fs.writeFileSync(path.join(dir, "baseline_summary.csv"), ctx.toCSV(sum));
  console.table(sum);
  console.log("rows:", rows.length, "->", path.join(dir, "baseline.csv"));
})();
