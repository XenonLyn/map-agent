const C = require('../src/core.js'); const { PRESETS } = require('../src/presets.js');
for (const pr of PRESETS) {
  const spec = C.normalizeSpec(pr.spec);
  let t = Date.now();
  let W = C.derive(spec, C.initParams(spec));
  console.log('\n==', pr.key, 'derive ms', Date.now() - t);
  let land = 0; for (let i = 0; i < C.NN; i++) if (!W.ocean[i]) land++;
  console.log('land frac', (land / C.NN).toFixed(2), 'rivers', W.hy.rivers.length, 'sinks', W.hy.sinks.length, 'mouths', W.hy.mouths.length);
  for (const mode of ['structured', 'blind']) {
    let Wc = W; let rep = C.verify(Wc); const hist = [];
    const line = [rep.fails.length];
    if (mode === 'structured') console.log(' init fails:', rep.fails.map(f => f.id + ' ' + f.measured).join(' | '));
    for (let it = 1; it <= 6 && rep.fails.length; it++) {
      const pol = mode === 'structured' ? C.scriptedStructured(Wc, rep, hist) : C.scriptedBlind(Wc, rep, hist, it);
      const r = C.applyActions(Wc, pol.actions); hist.push(r); Wc = r.W; rep = C.verify(Wc);
      line.push(rep.fails.length);
      if (mode === 'structured') { console.log('  it', it, pol.analysis); console.log('   ', r.results.map(x => x.a.tool + ':' + x.msg).join(' / ')); console.log('    fails:', rep.fails.map(f => f.id + ' ' + f.measured).join(' | ')); }
    }
    console.log(mode, 'fail trajectory', line.join(' -> '), 'rate', rep.rate.toFixed(2), 'lakes', Wc.hy.lakes.length, 'rivers', Wc.hy.rivers.length);
    if (mode === 'structured') {
      t = Date.now();
      const lore = C.scriptedLore(Wc, 'draft'); const r2 = C.verify(Wc, lore);
      console.log(' lore draft ms', Date.now() - t, 'lore fails', r2.fails.filter(f => f.cat === '叙事').map(f => f.label + ' / ' + f.measured).join(' | '));
      console.log(' sample', lore[0].text);
      const lore2 = C.scriptedLore(Wc, 'final'); const r3 = C.verify(Wc, lore2);
      console.log(' lore final fails', r3.fails.filter(f => f.cat === '叙事').length);
    }
  }
}
