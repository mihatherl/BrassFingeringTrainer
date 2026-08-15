import { instrumentById, writtenRange } from '../src/domain/instruments.ts';
import { metreFor } from '../src/domain/metre.ts';
import { DIFFICULTIES } from '../src/exercise/difficulty.ts';
import { generateExercise, type PatternRegister } from '../src/exercise/generate.ts';
const N = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const nm = (m: number) => `${N[((m%12)+12)%12]}${Math.floor(m/12)-1}`;

for (const [id, fifths] of [['eb-bass', -3], ['eb-bass', 2], ['cornet', -3]] as const) {
  const inst = instrumentById(id);
  const [lo, hi] = writtenRange(inst, 'treble');
  console.log(`\n${inst.name}, key ${fifths === -3 ? 'Eb' : 'D'} — compass ${nm(lo)}–${nm(hi)}; stave E4–F5`);
  for (const d of DIFFICULTIES) {
    const row: string[] = [];
    for (const register of ['low', 'middle', 'high'] as PatternRegister[]) {
      const ex = generateExercise({
        instrument: inst, clef: 'treble', fifths, difficulty: d, kind: 'drills',
        bars: 8, cycles: 1, themeCount: 2, metre: metreFor(4, 4), seed: 2, register,
      });
      const ns = ex.notes.map((n) => n.writtenMidi);
      row.push(`${register}: ${nm(Math.min(...ns))}–${nm(Math.max(...ns))}`);
    }
    console.log(`  ${d.patterns.label.padEnd(14)} ${row.join('   ')}`);
  }
}
