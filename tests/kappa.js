// Inter-annotator agreement (Cohen's kappa) for the proposal labels.
// Usage: node tests/kappa.js annotation/proposals_round1.csv
const fs = require("fs");
const rows = fs.readFileSync(process.argv[2] || "annotation/proposals_round1.csv", "utf8").trim().split("\n");
const cols = rows[0].split(","), iA = cols.indexOf("label_A"), iB = cols.indexOf("label_B");
const split = l => { const out = []; let cur = "", q = false; for (const c of l) { if (c === '"') q = !q; else if (c === "," && !q) { out.push(cur); cur = ""; } else cur += c; } out.push(cur); return out; };
const pairs = rows.slice(1).map(split).map(v => [(v[iA] || "").trim(), (v[iB] || "").trim()]).filter(([a, b]) => a && b);
if (!pairs.length) { console.log("还没有标注数据：请先填 label_A 和 label_B 两列"); process.exit(0); }
const labels = [...new Set(pairs.flat())];
const n = pairs.length;
let agree = 0; const cntA = {}, cntB = {};
for (const [a, b] of pairs) { if (a === b) agree++; cntA[a] = (cntA[a] || 0) + 1; cntB[b] = (cntB[b] || 0) + 1; }
const po = agree / n, pe = labels.reduce((s, l) => s + (cntA[l] || 0) / n * ((cntB[l] || 0) / n), 0);
console.log("样本数", n, "| 一致率", po.toFixed(2), "| kappa", ((po - pe) / (1 - pe)).toFixed(2));
console.log("标注者 A 分布", cntA, "\n标注者 B 分布", cntB);
console.log("分歧条目:", pairs.map((p, k) => [k, p]).filter(([, [a, b]]) => a !== b).map(([k]) => rows[k + 1].split(",")[0]).join(" ") || "无");
