# Region Map Agent

DSA4213 group-project demo: an agent turns a worldbuilding description into a regional map (1024 × 1024 km, 512 × 512 cells), a verifier checks physical and specification constraints, and the agent repairs the map through generator tools. Generated lore is checked claim by claim against the map, and settlements get procedural city plans with functional districts.

The whole app is one self-contained page: `dist/region-map-agent.html`. Open it in a browser (it loads three.js r128 and Google Fonts from CDNs; without three.js it falls back to the 2D map).

## Layout

| Path | Contents |
| --- | --- |
| `src/core.js` | Terrain (noise, ridges, valley carving, thermal erosion), climate, hydrology (D8 / priority-flood), biomes, verifier, repair tools, scripted policies, lore claims |
| `src/presets.js` | Four example WorldSpecs (coast, kingdom, island, contradictory landlocked port) |
| `src/city.js` | Regional road network (A* + MST) and settlement plans: districts, streets, blocks, buildings, landmarks, farmland; 2D drawing |
| `src/gamemap.js` | Game-style map view: tilted orthographic render of the 3D scene, fog of war, grid, waypoint/POI icons, region and town zoom levels |
| `src/view3d.js` | three.js diorama: terrain mesh, water, city decals, instanced buildings, landmark models, camera controls |
| `src/ui.js` | Agent loop, Claude calls (artifact `sample` capability), panels, 2D rendering, edits |
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

- **Claude mode** uses the claude.ai artifact runtime (`window.claude.use("sample")`). Outside claude.ai only the offline scripted policies run. To use the API elsewhere, replace `llmJSON` in `src/ui.js` with your own backend call.
- **Offline mode** is rule-based: it demonstrates the loop, not LLM ability.
- **Scale**: 1 cell = 2 km. Settlements are drawn at an exaggerated, map-style scale (a city plan is about 28 km across).
- **Scaling rule**: cell-based thresholds in `core.js` are tuned for N = 512. `SC = N / 256` scales most of them, but re-run `tests/test_core.js` after changing N.
