/* Beethoven Symphony No. 5 — electronic remix, fully synthesized with Web Audio API.
   32-bar loop @126bpm: INTRO (fate motif) → DROP A → BREAK (arp+riser) → DROP B → OUTRO. */

const NOTE_INDEX = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
function freqOf(name) {
  const m = name.match(/^([A-G][b#]?)(-?\d)$/);
  const midi = NOTE_INDEX[m[1]] + (parseInt(m[2], 10) + 1) * 12;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const BPM = 126;
const STEP = 60 / BPM / 4;        // 16th note
const BARS = 32;
const TOTAL_STEPS = BARS * 16;

// ---- The fate motif and derived melodies (C minor) ----
// [stepInPhrase, note, durationInSteps, velocity]
// Iconic "ta-ta-ta-TAA" at quarter spacing for the intro statement.
const MOTIF = [
  [4, 'G4', 3, 1], [8, 'G4', 3, 1], [12, 'G4', 3, 1], [16, 'Eb4', 14, 1],
  [36, 'F4', 3, 1], [40, 'F4', 3, 1], [44, 'F4', 3, 1], [48, 'D4', 14, 1],
];
// Double-time motif for the drops (4-bar phrases).
const DROP_A_MELODY = [
  [2, 'G4', 2, 1], [4, 'G4', 2, 1], [6, 'G4', 2, 1], [8, 'Eb4', 6, 1],
  [18, 'F4', 2, .9], [20, 'F4', 2, .9], [22, 'F4', 2, .9], [24, 'D4', 6, .9],
  [34, 'G4', 2, 1], [36, 'G4', 2, 1], [38, 'G4', 2, 1], [40, 'Eb4', 4, 1],
  [44, 'Ab4', 2, .9], [46, 'G4', 2, .9],
  [48, 'F4', 4, 1], [52, 'Eb4', 4, .9], [56, 'D4', 4, .9], [60, 'B3', 4, .9],
];
const DROP_B_MELODY = [
  [2, 'C5', 2, 1], [4, 'C5', 2, 1], [6, 'C5', 2, 1], [8, 'Ab4', 6, 1],
  [18, 'F4', 2, .9], [20, 'F4', 2, .9], [22, 'F4', 2, .9], [24, 'G4', 6, .9],
  [34, 'C5', 2, 1], [36, 'C5', 2, 1], [38, 'C5', 2, 1], [40, 'Eb5', 4, 1],
  [44, 'D5', 2, .9], [46, 'C5', 2, .9],
  [48, 'G4', 2, 1], [50, 'Ab4', 2, 1], [52, 'B4', 2, 1], [54, 'C5', 2, 1],
  [56, 'D5', 2, 1], [58, 'Eb5', 2, 1], [60, 'D5', 2, 1], [62, 'B4', 2, 1],
];
const ARP = ['C4', 'Eb4', 'G4', 'C5', 'Eb5', 'C5', 'G4', 'Eb4'];

const DROP_A_ROOTS = ['C2', 'C2', 'Ab1', 'G1'];
const DROP_B_ROOTS = ['C2', 'F1', 'Ab1', 'G1'];

export class AudioEngine {
  constructor() {
    this.events = [];         // visual events: {t, type, data}
    this.playing = false;
    this.step = 0;
    this.nextTime = 0;
    this._timer = null;
  }

  async start() {
    if (!this.ctx) this._build();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this._timer = setInterval(() => this._schedule(), 30);
  }

  pause() {
    this.playing = false;
    clearInterval(this._timer);
    if (this.ctx) this.ctx.suspend();
    this.events.length = 0;
  }

  _build() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 5;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.78;
    this.fft = new Uint8Array(this.analyser.frequencyBinCount);
    this.master.connect(this.comp).connect(this.analyser).connect(ctx.destination);

    // dotted-8th echo send for the lead
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = STEP * 6;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2600;
    this.delay.connect(damp).connect(fb).connect(this.delay);
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    this.delay.connect(wet).connect(this.master);
  }

  // ---------- sequencer ----------
  _schedule() {
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      this._scheduleStep(this.step % TOTAL_STEPS, this.nextTime);
      this.step++;
      this.nextTime += STEP;
    }
  }

  _scheduleStep(gs, t) {
    const bar = Math.floor(gs / 16);
    const s = gs % 16;

    if (bar < 8) this._intro(bar, s, t);
    else if (bar < 16) this._drop(bar - 8, s, t, DROP_A_MELODY, DROP_A_ROOTS, 'DROP A');
    else if (bar < 20) this._break(bar - 16, s, t);
    else if (bar < 28) this._drop(bar - 20, s, t, DROP_B_MELODY, DROP_B_ROOTS, 'DROP B');
    else this._outro(bar - 28, s, t);

    if (s === 0 && bar % 4 === 0) {
      const names = { 0: 'FATE MOTIF', 8: 'DROP A', 16: 'BREAK', 20: 'DROP B', 28: 'CODA' };
      if (names[bar]) this.events.push({ t, type: 'section', data: { name: names[bar] } });
    }
  }

  _melodyAt(phrase, melody, phraseSteps, t, opts) {
    for (const [st, note, dur, vel] of melody) {
      if (st === phrase % phraseSteps) {
        const f = freqOf(note);
        this.lead(t, f, dur * STEP, vel, opts);
        this.events.push({ t, type: 'note', data: { freq: f, dur: dur * STEP, vel } });
      }
    }
  }

  _intro(bar, s, t) {
    const phrase = (bar % 4) * 16 + s;
    const brightness = bar < 4 ? 900 : 2600;       // filter opens on the repeat
    this._melodyAt(phrase, MOTIF, 64, t, { cutoff: brightness, stab: true });
    if (bar >= 4 && (s === 2 || s === 6 || s === 10 || s === 14)) this.hat(t, false, 0.5);
    if (bar === 7) {                                // snare roll build
      if (s % 2 === 0 || s >= 8) { this.snare(t, 0.3 + (s / 16) * 0.7); this.events.push({ t, type: 'snare', data: { vel: 0.4 + s / 32 } }); }
    }
  }

  _drop(bar, s, t, melody, roots, name) {
    if (s % 4 === 0) { this.kick(t); this.events.push({ t, type: 'kick', data: {} }); }
    if (s === 4 || s === 12) { this.snare(t, 0.9); this.events.push({ t, type: 'snare', data: { vel: 0.9 } }); }
    if (s % 4 === 2) this.hat(t, s === 14, 0.8);
    else if (s % 2 === 1 && name === 'DROP B') this.hat(t, false, 0.25);

    if (s % 4 === 2) {                              // off-beat pumping bass
      const f = freqOf(roots[bar % 4]);
      this.bass(t, f, STEP * 1.8);
      this.events.push({ t, type: 'bass', data: { freq: f } });
    }
    this._melodyAt((bar % 4) * 16 + s, melody, 64, t, { cutoff: 3400 });
    // final-bar drum fill
    if (bar === 7 && s >= 12) { this.snare(t, 0.6 + (s - 12) * 0.13); }
  }

  _break(bar, s, t) {
    const prog = (bar * 16 + s) / 64;               // 0..1 across the break
    const note = ARP[s % 8];
    const f = freqOf(note);
    this.pluck(t, f, 500 + prog * 4200, 0.5 + prog * 0.4);
    this.events.push({ t, type: 'arp', data: { freq: f, prog } });
    if (bar === 0 && s === 0) this.pad(t, ['C3', 'Eb3', 'G3', 'C4'].map(freqOf), STEP * 64);
    if (bar >= 2) {
      if (s === 0 && bar === 2) this.riser(t, STEP * 32);
      if (s % 2 === 0) { this.snare(t, 0.2 + prog * 0.8); this.events.push({ t, type: 'snare', data: { vel: 0.2 + prog * 0.8 } }); }
      this.events.push({ t, type: 'riser', data: { prog } });
    }
  }

  _outro(bar, s, t) {
    if (s % 4 === 0) { this.kick(t); this.events.push({ t, type: 'kick', data: {} }); }
    if (s % 4 === 2) this.hat(t, false, 0.6);
    this._melodyAt((bar % 4) * 16 + s, MOTIF, 64, t, { cutoff: 3000, stab: true });
    if (s % 4 === 2) { this.bass(t, freqOf('C2'), STEP * 1.8); this.events.push({ t, type: 'bass', data: { freq: 65.4 } }); }
    if (bar === 3 && s === 12) this.crash(t);
  }

  // ---------- instruments ----------
  kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.11);
    g.gain.setValueAtTime(1.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.32);
    const click = this._noise(t, 0.02);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
    const cg = ctx.createGain(); cg.gain.setValueAtTime(0.25, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    click.connect(hp).connect(cg).connect(this.master);
  }

  snare(t, vel = 1) {
    const ctx = this.ctx;
    const n = this._noise(t, 0.2);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    n.connect(bp).connect(g).connect(this.master);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 210;
    const og = ctx.createGain(); og.gain.setValueAtTime(0.3 * vel, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.1);
  }

  hat(t, open, vel = 1) {
    const ctx = this.ctx;
    const n = this._noise(t, open ? 0.4 : 0.06);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.35 : 0.05));
    n.connect(hp).connect(g).connect(this.master);
  }

  crash(t) {
    const ctx = this.ctx;
    const n = this._noise(t, 1.6);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    n.connect(hp).connect(g).connect(this.master);
    this.events.push({ t, type: 'crash', data: {} });
  }

  bass(t, f, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.42, t);
    g.gain.setTargetAtTime(0, t + dur * 0.6, 0.05);
    o.connect(lp); sub.connect(lp); lp.connect(g).connect(this.master);
    o.start(t); sub.start(t); o.stop(t + dur + 0.3); sub.stop(t + dur + 0.3);
  }

  lead(t, f, dur, vel = 1, { cutoff = 3000, stab = false } = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const a = stab ? 0.004 : 0.01;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22 * vel, t + a);
    g.gain.setTargetAtTime(0.14 * vel, t + a, 0.08);
    g.gain.setTargetAtTime(0, t + dur, 0.07);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.5;
    lp.frequency.setValueAtTime(cutoff * 1.6, t);
    lp.frequency.exponentialRampToValueAtTime(cutoff, t + 0.15);
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur + 0.5);
    }
    const oct = ctx.createOscillator(); oct.type = 'square';
    oct.frequency.value = f / 2;
    const octG = ctx.createGain(); octG.gain.value = 0.35;
    oct.connect(octG).connect(lp); oct.start(t); oct.stop(t + dur + 0.5);
    lp.connect(g); g.connect(this.master); g.connect(this.delay);
  }

  pluck(t, f, cutoff, vel) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(cutoff, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.1), t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(lp).connect(g); g.connect(this.master); g.connect(this.delay);
    o.start(t); o.stop(t + 0.25);
  }

  pad(t, freqs, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + dur * 0.3);
    g.gain.setTargetAtTime(0, t + dur * 0.8, dur * 0.1);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
    for (const f of freqs) for (const det of [-5, 5]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur + 1);
    }
    lp.connect(g).connect(this.master);
  }

  riser(t, dur) {
    const ctx = this.ctx;
    const n = this._noise(t, dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(9000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.02, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + dur);
    g.gain.setTargetAtTime(0, t + dur, 0.05);
    n.connect(bp).connect(g).connect(this.master);
  }

  _noise(t, dur) {
    const ctx = this.ctx;
    if (!this._noiseBuf) {
      const len = ctx.sampleRate * 2;
      this._noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    src.start(t); src.stop(t + dur + 0.05);
    return src;
  }

  // ---------- analysis for visuals ----------
  /** returns {bass, mid, high} energies in 0..1 */
  energy() {
    if (!this.analyser) return { bass: 0, mid: 0, high: 0 };
    this.analyser.getByteFrequencyData(this.fft);
    const n = this.fft.length;
    const avg = (a, b) => {
      let s = 0; const i0 = Math.floor(a * n), i1 = Math.max(i0 + 1, Math.floor(b * n));
      for (let i = i0; i < i1; i++) s += this.fft[i];
      return s / (i1 - i0) / 255;
    };
    return { bass: avg(0, 0.06), mid: avg(0.06, 0.3), high: avg(0.3, 0.8) };
  }

  /** pops visual events that are due */
  dueEvents() {
    if (!this.ctx) return [];
    const now = this.ctx.currentTime;
    const due = [];
    let i = 0;
    while (i < this.events.length) {
      if (this.events[i].t <= now) due.push(this.events.splice(i, 1)[0]);
      else i++;
    }
    return due;
  }
}

/* Adaptive per-band statistics: rolling p10/p90 envelope for normalization,
   z-score onset detection, and a feedback loop that drifts the trigger
   threshold until the event rate converges to a target — so visual density
   stays consistent across genres and loudness levels. */
export class BandStat {
  constructor(targetRate, refractory) {
    this.target = targetRate;       // desired events per second
    this.refractory = refractory;   // min seconds between events
    this.mu = 0; this.var = 0;      // running mean / variance (onset reference)
    this.lo = 1; this.hi = 0;       // rolling low/high envelope (normalization)
    this.k = 2.4;                   // adaptive z-score threshold
    this.rate = 0;                  // measured events/sec (leaky integrator)
    this.lastFire = -1;
    this.norm = 0;                  // current energy normalized to this track
  }

  /** feed one frame of raw band energy; returns true when an onset fires */
  update(e, now, dt) {
    // asymmetric trackers ≈ rolling percentiles of this song's dynamics
    this.lo += (e < this.lo ? 0.4 : 0.02) * (e - this.lo) * Math.min(1, dt * 60);
    this.hi += (e > this.hi ? 0.4 : 0.02) * (e - this.hi) * Math.min(1, dt * 60);
    const span = Math.max(0.02, this.hi - this.lo);
    this.norm = Math.min(1, Math.max(0, (e - this.lo) / span));

    // ~1.2 s EMA mean/variance → z-score measures "surprise", not loudness
    const a = 1 - Math.exp(-dt / 1.2);
    this.mu += a * (e - this.mu);
    this.var += a * ((e - this.mu) * (e - this.mu) - this.var);
    const z = (e - this.mu) / (Math.sqrt(this.var) + 0.01);

    // rate feedback: too many events → raise threshold, too few → lower it
    this.rate *= Math.exp(-dt / 3);
    this.k = Math.min(6, Math.max(1.2, this.k + (this.rate - this.target) * dt * 0.7));

    // noise gate: must stand out of this song's own floor, plus absolute silence guard
    const gate = e > this.lo + span * 0.15 && e > 0.03;
    if (z > this.k && gate && now - this.lastFire > this.refractory) {
      this.lastFire = now;
      this.rate += 1 / 3;
      return true;
    }
    return false;
  }
}

/* Plays a user-uploaded audio file and extracts beat/melody events in real time,
   with whole-track gain normalization + adaptive per-band analysis. */
export class TrackPlayer {
  constructor() {
    this.playing = false;
    this.name = '';
    this.offset = 0;
    this._resetStats();
  }

  _resetStats() {
    this.bands = {
      bass: new BandStat(2.0, 0.2),   // kicks
      high: new BandStat(2.5, 0.15),  // snares / hats
      mid: new BandStat(3.0, 0.12),   // melody / vocals
    };
    this._norm = { bass: 0, mid: 0, high: 0 };
    this._lastT = 0;
  }

  _build() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();          // AGC makeup gain, set per track
    this.master.gain.value = 0.9;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 4;
    limiter.ratio.value = 14;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.18;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    this.fft = new Uint8Array(this.analyser.frequencyBinCount);
    this.master.connect(limiter).connect(this.analyser).connect(ctx.destination);
  }

  async load(file) {
    if (!this.ctx) this._build();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const data = await file.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(data);
    this.name = file.name.replace(/\.[^.]+$/, '');
    this.offset = 0;
    this._resetStats();

    // whole-track RMS → makeup gain toward a common loudness target,
    // so quiet acoustic recordings and brick-walled EDM analyze alike
    const ch = this.buffer.getChannelData(0);
    let sum = 0, n = 0;
    for (let i = 0; i < ch.length; i += 64) { sum += ch[i] * ch[i]; n++; }
    const rms = Math.sqrt(sum / n) || 0.01;
    this.master.gain.value = Math.min(6, Math.max(0.4, 0.2 / rms));
  }

  async start() {
    if (!this.buffer) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.src = this.ctx.createBufferSource();
    this.src.buffer = this.buffer;
    this.src.loop = true;
    this.src.connect(this.master);
    this.startedAt = this.ctx.currentTime;
    this._lastT = this.ctx.currentTime;
    this.src.start(0, this.offset % this.buffer.duration);
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.offset = (this.offset + this.ctx.currentTime - this.startedAt) % this.buffer.duration;
    try { this.src.stop(); } catch (_) {}
    this.playing = false;
  }

  _rawEnergy() {
    this.analyser.getByteFrequencyData(this.fft);
    const n = this.fft.length;
    const avg = (a, b) => {
      let s = 0; const i0 = Math.floor(a * n), i1 = Math.max(i0 + 1, Math.floor(b * n));
      for (let i = i0; i < i1; i++) s += this.fft[i];
      return s / (i1 - i0) / 255;
    };
    return { bass: avg(0, 0.05), mid: avg(0.05, 0.25), high: avg(0.3, 0.8) };
  }

  /** normalized 0..1 band levels relative to THIS track's dynamics (for curl/glow) */
  energy() {
    return { ...this._norm };
  }

  /** call once per frame; returns fluid events detected from the live spectrum */
  detect() {
    if (!this.playing) return [];
    const now = this.ctx.currentTime;
    const dt = Math.min(0.1, Math.max(0.001, now - this._lastT));
    this._lastT = now;

    const e = this._rawEnergy();
    const ev = [];
    const fired = {};
    for (const band of ['bass', 'mid', 'high']) {
      fired[band] = this.bands[band].update(e[band], now, dt);
      this._norm[band] = this.bands[band].norm;
    }

    if (fired.bass) ev.push({ type: 'kick', data: {} });
    if (fired.high) ev.push({ type: 'snare', data: { vel: 0.4 + 0.6 * this.bands.high.norm } });
    if (fired.mid) ev.push({ type: 'note', data: { freq: this._dominantFreq(), vel: 0.4 + 0.6 * this.bands.mid.norm } });
    return ev;
  }

  /** strongest spectral peak between ~150 Hz and ~2.5 kHz */
  _dominantFreq() {
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const i0 = Math.max(1, Math.round(150 / binHz));
    const i1 = Math.min(this.fft.length - 1, Math.round(2500 / binHz));
    let best = i0;
    for (let i = i0; i <= i1; i++) if (this.fft[i] > this.fft[best]) best = i;
    return best * binHz;
  }
}
