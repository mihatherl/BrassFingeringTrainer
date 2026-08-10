import { INSTRUMENTS, availableClefs, writtenRange } from '../src/domain/instruments.ts';
const N = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const nm = (m: number) => `${N[((m%12)+12)%12]}${Math.floor(m/12)-1}`;
for (const i of INSTRUMENTS) for (const c of availableClefs(i)) {
  const [lo, hi] = writtenRange(i, c);
  console.log(`${i.name.padEnd(22)} ${c.padEnd(6)} ${nm(lo)}–${nm(hi)} (${hi-lo} semitones)`);
}
