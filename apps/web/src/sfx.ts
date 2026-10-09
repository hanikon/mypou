import { signal } from '@preact/signals';

/** Короткие звуки синтезируются на лету (WebAudio) — без файлов и чужих ассетов. */
const KEY = 'kaplya:sound';
const read = () => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
};
export const soundOn = signal(read());

export function toggleSound() {
  soundOn.value = !soundOn.value;
  try {
    localStorage.setItem(KEY, soundOn.value ? 'on' : 'off');
  } catch {
    /* не критично */
  }
}

let ctx: AudioContext | undefined;

function tone(freq: number, endFreq: number, ms: number, type: OscillatorType = 'sine', vol = 0.15) {
  if (!soundOn.value) return;
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + ms / 1000);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000);
  } catch {
    /* звук не обязателен */
  }
}

export const sfx = {
  pop: () => tone(900, 300, 90, 'triangle'),
  chomp: () => {
    tone(220, 120, 80, 'square', 0.08);
    setTimeout(() => tone(200, 110, 80, 'square', 0.08), 140);
  },
  coin: () => {
    tone(880, 1320, 90, 'triangle');
    setTimeout(() => tone(1320, 1760, 120, 'triangle'), 90);
  },
  squeak: () => tone(500, 1100, 120, 'sine', 0.1),
  error: () => tone(220, 160, 180, 'sawtooth', 0.06),
};
