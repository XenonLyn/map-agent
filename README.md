# Region Map Agent

DSA4213 group-project demo: an agent turns a worldbuilding description into a regional map (1024 × 1024 km, 512 × 512 cells), a verifier checks physical and specification constraints, and the agent repairs the map through generator tools. Generated lore is checked claim by claim against the map, and settlements get procedural city plans with functional districts.

The whole app is one self-contained page: `dist/region-map-agent.html`. Open it in a browser (it loads three.js r128 and Google Fonts from CDNs; without three.js it falls back to the 2D map).

## Layout

| Path | Contents |
| --- | --- |
| `src/core.js` | Terrain (noise, ridges, valley carving, thermal erosion), climate, hydrology (D8 / priority-flood), biomes, verifier, conflict analysis and relaxation, repair tools, scripted policies, lore claims |
| `src/presets.js` | Four example WorldSpecs (coast, kingdom, island, contradictory landlocked port) |
| `src/city.js` | Regional road network (A* + MST) and settlement plans: districts, streets, blocks, buildings, landmarks, farmland; the style profile that drives them; 2D drawing |
| `src/gamemap.js` | Game-style map view: tilted orthographic render of the 3D scene, fog of war, grid, waypoint/POI icons, region and town zoom levels |
| `src/view3d.js` | three.js diorama: terrain mesh, water, city decals, instanced buildings, landmark models, camera controls |
| `src/ui.js` | Agent loop, the four Claude stages (plan, relations, negotiate, repair) plus lore, panels, 2D rendering, edits |
| `src/template.html` | Page markup and CSS; `build.py` inlines the scripts at `/*__SCRIPT__*/` |
| `src/bench.js` | Test-set generator, trial runner with 20 metrics, conflict-core review export, fault-injection harness (shared by node and the browser) |
| `tests/` | Node tests for the core loop and city generation; Playwright screenshot script |

## Build and test

### Experiments

```bash
node tests/benchmark.js 30 6 structured 0 30   # baseline, one feedback condition at a time (appends to results/baseline.csv)
node tests/benchmark.js 30 6 binary 0 30
node tests/benchmark.js 30 6 none 0 30
node tests/injection.js 10                     # verifier reliability (only injects into worlds the verifier calls clean)
node tests/benchmark.js 30 6 structured 0 30 negotiate   # same, with the conflict-resolution stage on (ablation)
```

In the page (claude.ai, Claude engine enabled), from the browser console:

```js
runBatch({n: 12, policy: "llm", feedback: "structured"})  // group A: same WorldSpec, agent vs rule baseline
runExtraction()                                           // group B: free text -> WorldSpec, which the baseline cannot do
```

Both download a CSV with the same columns as `results/baseline.csv`.

```bash
python3 build.py          # writes dist/region-map-agent.html
node tests/test_core.js   # scripted agent on every preset: violation trajectories, structured vs blind feedback
node tests/test_city.js   # roads and city plans: counts and timings
npm install               # only needed for the screenshot script (local three.js)
python3 tests/screenshots.py 0
```

## Notes

- **Where each deployment runs.** The page has two engines, and which one is available depends entirely on where it is
  opened. **Claude mode** needs `window.claude.use("sample")`, which only the claude.ai artifact runtime injects — open
  `dist/region-map-agent.html` as an artifact and the Claude radio unlocks. **Anywhere else, including the GitHub Pages
  copy at the repo root, there is no such object**, so the radio stays disabled and only the offline scripted policies
  run. That is a property of the host, not a fault in the page: a static site cannot hold an API key without publishing
  it, which is why the browser SDK gates direct browser calls behind an option named `dangerouslyAllowBrowser`. To run
  the LLM stages from a static host, put an API key behind a small backend of your own and replace `llmJSON` in
  `src/ui.js` with a call to it — do not inline a key into the page.
- **What the offline demo still shows.** Terrain, climate and hydrology, the verifier, the repair loop, the conflict
  analysis and the rule-based negotiator, the city planner and every street pattern all run with no model at all. What
  it cannot show is the four model stages: free text → WorldSpec, relation proposals, conflict resolution, and lore.
- **Offline mode** is rule-based: it demonstrates the loop, not LLM ability.
- **Conflict resolution**: when a settlement's constraints cannot all hold, `minimalCore` in `src/core.js` computes a
  minimal unsatisfiable core by deletion, against `REACHABLE` rather than the current map — so "unsatisfiable" means
  "no tool can fix this", not "not satisfied yet". `conflictBriefs` turns each core into the negotiator's whole input:
  every item with its provenance (`explicit` = written by the author, `proposed` = inferred by `llmPlan`, with the
  reason that stage gave) and what it could be traded for, each option carrying how many sites satisfy it now and how
  many would after the terrain tools do their best. `relax_constraint` then swaps a constraint for a weaker one or
  drops it; it refuses any item the solver did not put in a core, any swap that is not a weakening, and any call with
  no reason, so a constraint is only ever given up against a proof that it cannot be kept. The decision itself is a
  stage of its own — `llmNegotiate` in `src/ui.js`, the only stage that receives the original description, because
  ranking two constraints is a question about authorial intent and the WorldSpec no longer contains it. Offline,
  `scriptedNegotiate` stands in and can only rank by provenance and room, which is the baseline the LLM stage is meant
  to beat. Relaxed checks stay on the report with their reason (`status: "relaxed"`), out of the failure count and out
  of the pass rate, so every trade is auditable. `runTrial` takes the stage as an option, so it can be ablated.
- **Style profile**: the intent layer (`llmPlan`) reads an era, a street pattern, block and building scale, a wall
  policy and a landmark vocabulary off the description, and `cityPlan` in `src/city.js` builds the town from them.
  `street_pattern` picks the road skeleton and what each district's block lattice lines up with — `organic` (noise-warped
  districts, each aligned to its nearest main road), `grid` (one lattice through the whole town), `radial` (extra spokes,
  blocks facing the centre), `ring` (concentric rings, blocks tangential), `terraced` (blocks follow the terrain contour).
  `era` fixes the landmark vocabulary, so a medieval town gets a cathedral and a keep while a modern one gets a station,
  a hospital and factories; a landmark outside the vocabulary is substituted by one with the same function or dropped.
  Nothing here touches geography: the style decides how a settlement is drawn, never where it is, and the verifier's
  checks are unchanged by it. Panel 4 has era / pattern / wall controls that re-plan the towns without re-running the agent.
- **Scale**: 1 cell = 2 km. Settlements are drawn at an exaggerated, map-style scale (a city plan is about 28 km across).
- **Scaling rule**: cell-based thresholds in `core.js` are tuned for N = 512. `SC = N / 256` scales most of them, but re-run `tests/test_core.js` after changing N.
