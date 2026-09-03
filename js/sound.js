// ============================================================
// เสียงประกอบ — สังเคราะห์เองด้วย WebAudio ไม่มีไฟล์ ไม่มีลิขสิทธิ์
// ============================================================

let ctx = null;
let on = localStorage.getItem('coup-sound') !== 'off';

export const isOn = () => on;

export function toggle() {
  on = !on;
  localStorage.setItem('coup-sound', on ? 'on' : 'off');
  if (on) play('tap');
  return on;
}

function tone(freq, dur, type = 'sine', vol = 0.14, delay = 0) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const RECIPES = {
  tap:    () => tone(520, 0.06, 'triangle', 0.10),
  gold:   () => { tone(660, 0.09, 'sine', 0.12); tone(990, 0.12, 'sine', 0.10, 0.06); },
  flip:   () => tone(340, 0.10, 'square', 0.07),
  gone:   () => { tone(300, 0.16, 'sawtooth', 0.09); tone(180, 0.24, 'sawtooth', 0.08, 0.10); },
  alert:  () => { tone(760, 0.10, 'square', 0.10); tone(760, 0.10, 'square', 0.10, 0.16); },
  tick:   () => tone(880, 0.04, 'sine', 0.06),
  win:    () => [0, 0.11, 0.22, 0.36].forEach((d, i) => tone([523, 659, 784, 1047][i], 0.30, 'sine', 0.13, d)),
};

export function play(name) {
  if (!on) return;
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    RECIPES[name]?.();
  } catch { /* บางเบราว์เซอร์ปิดเสียงไว้ — ไม่เป็นไร เกมเล่นต่อได้ */ }
}
