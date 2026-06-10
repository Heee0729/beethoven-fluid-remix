// Simulation test: BandStat should converge to similar event rates for
// wildly different "genres" (loud dense EDM vs quiet sparse folk).
import { BandStat } from './audio.js';

function simulate(label, { base, pulse, beatHz, noise, seconds = 90 }) {
  const b = new BandStat(2.0, 0.2);
  const dt = 1 / 60;
  let events = 0, eventsTail = 0;
  const tail = seconds / 2;
  for (let t = 0; t < seconds; t += dt) {
    const phase = (t * beatHz) % 1;
    const hit = phase < 0.07 ? pulse : 0;           // short energy burst per beat
    const e = base + hit + (Math.random() - 0.5) * noise;
    if (b.update(e, t, dt)) {
      events++;
      if (t > tail) eventsTail++;
    }
  }
  const rate = eventsTail / (seconds - tail);
  console.log(
    `${label}: total=${events}, steady-state rate=${rate.toFixed(2)}/s (target 2.0, beat ${beatHz}/s), k=${b.k.toFixed(2)}, norm-range lo=${b.lo.toFixed(3)} hi=${b.hi.toFixed(3)}`
  );
  return rate;
}

const edm = simulate('EDM   (loud, 2.6 beats/s) ', { base: 0.55, pulse: 0.3, beatHz: 2.6, noise: 0.08 });
const folk = simulate('Folk  (quiet, 1.0 beat/s) ', { base: 0.05, pulse: 0.05, beatHz: 1.0, noise: 0.015 });
const wall = simulate('Wall  (constant loudness) ', { base: 0.8, pulse: 0.02, beatHz: 2.0, noise: 0.02 });
const silence = simulate('Quiet (near-silence)      ', { base: 0.005, pulse: 0.005, beatHz: 1.0, noise: 0.004 });

let ok = true;
const assert = (cond, msg) => { if (!cond) { ok = false; console.error('FAIL:', msg); } };
assert(edm >= 1.4 && edm <= 2.8, `EDM rate ${edm.toFixed(2)} should be ~2/s, not flooded by 2.6/s beat`);
assert(folk >= 0.6 && folk <= 1.4, `Folk rate ${folk.toFixed(2)} should track its real ~1/s beat`);
assert(silence < 0.3, `Near-silence rate ${silence.toFixed(2)} should be gated, no hallucinated beats`);
console.log(ok ? 'ALL CHECKS PASSED' : 'CHECKS FAILED');
process.exit(ok ? 0 : 1);
