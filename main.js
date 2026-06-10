import { AudioEngine } from './audio.js';
import { Fluid } from './fluid.js';

const canvas = document.getElementById('c');
const playBtn = document.getElementById('play');
const overlay = document.getElementById('overlay');
const sectionEl = document.getElementById('section');

const fluid = new Fluid(canvas);
const audio = new AudioEngine();

// ---- palettes per section (base hue, hue spread) ----
const PALETTES = {
  'FATE MOTIF': { hue: 0.09, spread: 0.06 },  // bronze gold
  'DROP A':     { hue: 0.98, spread: 0.10 },  // crimson / orange
  'BREAK':      { hue: 0.52, spread: 0.08 },  // teal
  'DROP B':     { hue: 0.78, spread: 0.12 },  // violet / magenta
  'CODA':       { hue: 0.11, spread: 0.05 },  // gold
};
let palette = PALETTES['FATE MOTIF'];

function hsv(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i % 6];
}
const col = (hOff = 0, v = 0.3) => hsv(palette.hue + hOff, 0.95, v);
const rnd = (a, b) => a + Math.random() * (b - a);

// pitch → horizontal position (C3..C6 log-mapped)
const pitchX = (f) => Math.min(0.92, Math.max(0.08, (Math.log2(f / 130.8) / 3)));

// ---- beat choreography ----
function onEvent(ev) {
  const d = ev.data;
  switch (ev.type) {
    case 'section':
      palette = PALETTES[d.name] || palette;
      sectionEl.textContent = d.name;
      sectionEl.classList.remove('pop'); void sectionEl.offsetWidth;
      sectionEl.classList.add('pop');
      break;

    case 'kick': // shockwave ring from bottom center
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * (0.15 + 0.7 * (i / 6));
        fluid.splat(0.5 + Math.cos(a) * 0.05, 0.10,
          Math.cos(a) * 420, Math.sin(a) * 620,
          col(rnd(-0.02, 0.02), 0.34), 0.006);
      }
      kickPulse = 1;
      break;

    case 'snare': // pincer jets from the sides
      fluid.splat(0.04, rnd(0.55, 0.75), 520 * d.vel, rnd(-60, 60), col(0.05, 0.26 * d.vel), 0.0035);
      fluid.splat(0.96, rnd(0.55, 0.75), -520 * d.vel, rnd(-60, 60), col(0.05, 0.26 * d.vel), 0.0035);
      break;

    case 'note': { // melody comet, position by pitch
      const x = pitchX(d.freq);
      const swirl = rnd(-220, 220);
      fluid.splat(x, 0.78, swirl, -rnd(180, 420) * d.vel,
        col((x - 0.5) * palette.spread * 2, 0.4 * d.vel), 0.0045);
      break;
    }

    case 'bass': // deep slow bloom along the floor
      fluid.splat(rnd(0.35, 0.65), 0.04, rnd(-80, 80), 160,
        col(-0.04, 0.18), 0.012);
      break;

    case 'arp': { // spinning orbit during the break
      const a = d.prog * Math.PI * 10 + Math.log2(d.freq) * 0.7;
      const r = 0.16 + d.prog * 0.14;
      fluid.splat(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r * 1.3,
        -Math.sin(a) * 320, Math.cos(a) * 320,
        col(d.prog * 0.25, 0.3), 0.003);
      break;
    }

    case 'riser': // tension: everything spirals upward
      fluid.splat(rnd(0.3, 0.7), rnd(0.1, 0.3), rnd(-150, 150), 300 + d.prog * 500,
        col(0.1, 0.1 + d.prog * 0.2), 0.004);
      break;

    case 'crash': // supernova
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        fluid.splat(0.5, 0.5, Math.cos(a) * 900, Math.sin(a) * 900,
          col(i / 14 - 0.5, 0.5), 0.008);
      }
      break;
  }
}

// ---- ambient idle motion before playback ----
let idleT = 0;
function idleSplats(dt) {
  idleT += dt;
  if (idleT > 0.35) {
    idleT = 0;
    const a = rnd(0, Math.PI * 2);
    fluid.splat(rnd(0.2, 0.8), rnd(0.2, 0.8),
      Math.cos(a) * 120, Math.sin(a) * 120, col(rnd(-0.05, 0.05), 0.08), 0.005);
  }
}

// ---- pointer interaction ----
let pointer = null;
canvas.addEventListener('pointerdown', (e) => { pointer = { x: e.clientX, y: e.clientY }; });
window.addEventListener('pointerup', () => { pointer = null; });
window.addEventListener('pointermove', (e) => {
  if (!pointer) return;
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = 1 - (e.clientY - r.top) / r.height;
  const dx = (e.clientX - pointer.x) * 8;
  const dy = -(e.clientY - pointer.y) * 8;
  fluid.splat(x, y, dx, dy, col(rnd(-0.08, 0.08), 0.35), 0.004);
  pointer = { x: e.clientX, y: e.clientY };
});

// ---- main loop ----
let last = performance.now();
let kickPulse = 0;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;

  if (audio.playing) {
    for (const ev of audio.dueEvents()) onEvent(ev);
    const { bass, mid, high } = audio.energy();
    // low end drives swirliness, highs drive sparkle dissipation
    fluid.params.curl = 16 + bass * 38;
    fluid.params.dyeDissipation = 0.982 + high * 0.012;
    kickPulse = Math.max(0, kickPulse - dt * 4);
    fluid.step(dt);
    fluid.render(bass * 0.8 + kickPulse * 0.6 + mid * 0.3);
  } else {
    idleSplats(dt);
    fluid.step(dt);
    fluid.render(0);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- transport ----
let started = false;
playBtn.addEventListener('click', async () => {
  if (!started || !audio.playing) {
    await audio.start();
    started = true;
    overlay.classList.add('hidden');
    playBtn.textContent = '❚❚';
  } else {
    audio.pause();
    overlay.classList.remove('hidden');
    playBtn.textContent = '▶';
  }
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
});
