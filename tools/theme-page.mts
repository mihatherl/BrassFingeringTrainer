/**
 * The corpus as a self-contained page: index, engraving, and playback.
 *
 * A pure function rather than a script, because two things want it: the
 * command-line sheet used while writing themes, and the copy published under
 * `public/spike/`, which a test holds to what this produces so the published
 * one cannot quietly go stale — the exact fault `tools/` had for four releases.
 *
 * Self-contained on purpose: inline styles, inline SVG, inline script, no
 * requests of any kind. It ships inside an app that makes none, and a review
 * page that needs the network to draw or to sound is no use where music is
 * played. The tones are synthesised in a few lines of WebAudio rather than
 * borrowing the app's sampled instruments, which are two megabytes and belong
 * to the app.
 *
 * What it plays is the *written* pitch, not the sounding one. An Eb bass part
 * sounds two octaves and a sixth below where it is written, which on a laptop
 * is felt rather than heard; the written pitch is what a reader hums off the
 * page, and auditioning a tune is what this is for.
 */

import { describeFifths } from '../src/domain/keys.ts';
import { metreFor } from '../src/domain/metre.ts';
import { instrumentById, type Clef } from '../src/domain/instruments.ts';
import { DIFFICULTIES } from '../src/exercise/difficulty.ts';
import { exerciseFromTheme, isRest, validateTheme, type Theme } from '../src/exercise/theme.ts';
import { tiedBeats } from '../src/exercise/ties.ts';
import { THEMES } from '../src/exercise/themes.ts';
import { exerciseToSvg } from './render-svg.mts';

export interface ThemePageOptions {
  instrumentId: string;
  clef: Clef;
  fifths: number;
  width: number;
  /** One difficulty only, or every one. */
  difficulty?: string;
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** What a reader wants to know about a theme before opening it. */
function featuresOf(theme: Theme): string[] {
  const notes = theme.events.filter((e) => !isRest(e));
  const features: string[] = [];
  if (theme.events.some(isRest)) features.push('rests');
  if (notes.some((note) => 'tied' in note && note.tied)) features.push('ties');
  if (notes.some((note) => 'alter' in note && (note.alter ?? 0) !== 0)) features.push('accidentals');
  if (theme.keyChanges?.length) features.push('key change');
  const shortest = Math.min(...theme.events.map((e) => e.beats));
  if (shortest <= 0.25) features.push('semiquavers');
  else if (shortest <= 0.5) features.push('quavers');
  return features;
}

export function themePageHtml(options: ThemePageOptions): string {
  const instrument = instrumentById(options.instrumentId);
  const { clef, fifths, width } = options;

  const shown = THEMES.filter((t) => !options.difficulty || t.difficulty === options.difficulty);

  /*
   * Everything the page needs about a theme, settled here rather than in the
   * browser: the engraving, and the notes to sound. A tie is one sound, so a
   * chain is merged into its head and the tails are dropped — the same rule the
   * synth in the app follows, and the reason a tie is never re-attacked.
   */
  const data = shown.map((theme) => {
    const [beatsPerBar, beatUnit] = theme.metres[0];
    const exercise = exerciseFromTheme(theme, {
      instrument,
      clef,
      fifths,
      metre: metreFor(beatsPerBar, beatUnit),
    });

    const notes = exercise
      ? exercise.notes
          .map((note, index) => ({ note, index }))
          .filter(({ index }) => index === 0 || !exercise.notes[index - 1].tiedToNext)
          .map(({ note, index }) => [
            note.writtenMidi,
            note.startBeat,
            tiedBeats(exercise.notes, index),
          ])
      : [];

    return {
      theme,
      exercise,
      metre: `${beatsPerBar}/${beatUnit}`,
      problems: validateTheme(theme),
      features: featuresOf(theme),
      json: {
        id: theme.id,
        name: theme.name,
        difficulty: theme.difficulty,
        metre: `${beatsPerBar}/${beatUnit}`,
        bars: theme.bars,
        beatsPerBar: metreFor(beatsPerBar, beatUnit).barBeats,
        notes,
      },
    };
  });

  // Summary: how many themes sit at each difficulty, in each metre.
  const metres = [...new Set(THEMES.map((t) => `${t.metres[0][0]}/${t.metres[0][1]}`))].sort();
  const summaryRows = DIFFICULTIES.map((d) => {
    const cells = metres.map((m) => {
      const count = THEMES.filter(
        (t) => t.difficulty === d.id && `${t.metres[0][0]}/${t.metres[0][1]}` === m,
      ).length;
      // A gap is the thing this table exists to show: nothing written there
      // means the app quietly falls back to a random walk.
      return count === 0
        ? '<td class="gap" title="falls back to generated material">—</td>'
        : `<td>${count}</td>`;
    });
    const total = THEMES.filter((t) => t.difficulty === d.id).length;
    return `<tr><th>${escape(d.name)}</th>${cells.join('')}<td class="total">${total}</td></tr>`;
  });

  const indexRows = data.map(
    ({ theme, metre, features, problems, exercise }) =>
      `<tr data-id="${escape(theme.id)}" class="${problems.length ? 'is-broken' : ''}">` +
      `<td class="pick"><button type="button" class="open">${escape(theme.name)}</button>` +
      `<code>${escape(theme.id)}</code></td>` +
      `<td>${escape(theme.difficulty)}</td><td>${metre}</td><td>${theme.bars}</td>` +
      `<td class="features">${features.map((f) => `<span>${f}</span>`).join('')}</td>` +
      `<td class="verdict"><button type="button" data-verdict="keep">keep</button>` +
      `<button type="button" data-verdict="bin">bin</button></td>` +
      `<td class="note">${problems.length ? '<span class="problem">invalid</span>' : exercise ? '' : '<span class="problem">will not fit</span>'}</td>` +
      `</tr>`,
  );

  const scores = data.map(
    ({ theme, exercise }) =>
      `<div class="score" data-id="${escape(theme.id)}" hidden>` +
      (exercise
        ? exerciseToSvg(exercise, width)
        : `<p class="problem">Does not fit ${escape(instrument.name)} in this key.</p>`) +
      `</div>`,
  );

  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Themes — Brass Fingering Trainer</title>
    <style>
      :root { color-scheme: light dark; --bg: #fbfaf7; --text: #16150f; --muted: #6b6960;
              --border: #ddd9d0; --bad: #c02b2b; --good: #1a7f4b; --paper: #ffffff;
              --accent: #2f6fd0; --surface: #ffffff; }
      @media (prefers-color-scheme: dark) {
        :root { --bg: #16171b; --text: #f2f1ec; --muted: #9a9ba3; --border: #333640;
                --bad: #f87171; --good: #4ade80; --paper: #f4f2ec; --accent: #63a1ff;
                --surface: #1e2026; }
      }
      * { box-sizing: border-box; }
      body { margin: 0 auto; padding: 1.5rem 1rem 6rem; max-width: ${width + 64}px;
             background: var(--bg); color: var(--text);
             font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; }
      h1 { margin: 0 0 .25rem; font-size: 1.5rem; }
      h2 { margin: 2rem 0 .5rem; font-size: 1.1rem; text-transform: uppercase;
           letter-spacing: .06em; color: var(--muted); }
      p { margin: 0 0 .5rem; }
      .lede { color: var(--muted); font-size: .9rem; }
      code { font-size: .85em; color: var(--muted); }
      table { border-collapse: collapse; width: 100%; font-size: .9rem; }
      th, td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid var(--border); }
      thead th { color: var(--muted); font-weight: 600; font-size: .8rem;
                 text-transform: uppercase; letter-spacing: .04em; }
      .summary td, .summary th { text-align: center; }
      .summary th:first-child, .summary tr th:first-child { text-align: left; }
      .summary .gap { color: var(--bad); }
      .summary .total { font-weight: 700; }
      .pick { display: flex; flex-direction: column; gap: .1rem; }
      .open { background: none; border: 0; padding: 0; font: inherit; font-weight: 600;
              color: var(--accent); cursor: pointer; text-align: left; }
      .features span { display: inline-block; border: 1px solid var(--border);
                       border-radius: 999px; padding: 0 .45rem; margin: 0 .2rem .2rem 0;
                       font-size: .75rem; color: var(--muted); }
      .verdict button { font: inherit; font-size: .8rem; padding: .1rem .5rem; cursor: pointer;
                        border: 1px solid var(--border); background: var(--surface);
                        color: var(--text); border-radius: 4px; margin-right: .25rem; }
      tr.keep .verdict button[data-verdict="keep"] { border-color: var(--good); color: var(--good); }
      tr.bin { opacity: .55; }
      tr.bin .verdict button[data-verdict="bin"] { border-color: var(--bad); color: var(--bad); }
      .problem { color: var(--bad); }
      /*
       * Deliberately not sticky. It was, and a twelve-bar theme is three
       * systems tall — enough to cover the index it is meant to sit beside, so
       * rows scrolled under it could not be clicked at all. Clicking a name
       * scrolls here instead, and the score scrolls inside itself when long.
       */
      #viewer { background: var(--bg); padding-top: .5rem; margin-bottom: 1rem;
                border-bottom: 1px solid var(--border); }
      #viewer h3 { margin: 0; font-size: 1.1rem; }
      #controls { display: flex; align-items: center; gap: .75rem; margin: .4rem 0 .6rem;
                  flex-wrap: wrap; }
      #controls button { font: inherit; padding: .25rem .9rem; cursor: pointer;
                         border: 1px solid var(--border); border-radius: 4px;
                         background: var(--surface); color: var(--text); }
      #controls label { color: var(--muted); font-size: .85rem; }
      #score { max-height: 60vh; overflow-y: auto; }
      .score svg { max-width: 100%; height: auto; background: var(--paper); border-radius: 4px; }
      #feedback textarea { width: 100%; min-height: 5rem; font: inherit; font-size: .85rem;
                           background: var(--surface); color: var(--text);
                           border: 1px solid var(--border); border-radius: 4px; padding: .5rem; }
    </style>
  </head>
  <body>
    <h1>Themes</h1>
    <p class="lede">${escape(instrument.name)} · ${escape(clef)} clef ·
      ${escape(describeFifths(fifths))} · ${shown.length} shown of ${THEMES.length}</p>
    <p class="lede">Click a name to see it and play it. Playback sounds the written pitch, not
      the transposed one, so it is what you would hum off the page rather than what the
      instrument sounds.</p>

    <h2>By difficulty and time signature</h2>
    <table class="summary">
      <thead><tr><th>Difficulty</th>${metres.map((m) => `<th>${m}</th>`).join('')}<th>All</th></tr></thead>
      <tbody>${summaryRows.join('')}</tbody>
    </table>
    <p class="lede">A dash is a gap: the app falls back to generated material there, and says
      nothing about having done so.</p>

    <div id="viewer" hidden>
      <h3 id="viewer-name"></h3>
      <div id="controls">
        <button type="button" id="play">Play</button>
        <button type="button" id="stop">Stop</button>
        <label>Tempo <input type="range" id="tempo" min="40" max="160" value="80" /></label>
        <span id="bpm">80 bpm</span>
      </div>
      <div id="score"></div>
    </div>

    <h2>Index</h2>
    <table>
      <thead><tr><th>Theme</th><th>Level</th><th>Metre</th><th>Bars</th><th>Features</th>
        <th>Verdict</th><th></th></tr></thead>
      <tbody id="index">${indexRows.join('')}</tbody>
    </table>

    <h2 id="feedback-heading">What to change</h2>
    <div id="feedback">
      <p class="lede">Marked verdicts are remembered in this browser. Copy the list and send it
        back; anything not marked is untouched.</p>
      <textarea id="verdicts" readonly></textarea>
      <p><button type="button" id="copy">Copy</button>
        <button type="button" id="clear">Clear all verdicts</button></p>
    </div>

    <div id="scores" hidden>${scores.join('')}</div>

    <script>
      var THEMES = ${JSON.stringify(data.map((d) => d.json))};
      var byId = {};
      THEMES.forEach(function (t) { byId[t.id] = t; });

      var audio = null;
      var timers = [];
      var current = null;

      function stop() {
        timers.forEach(function (t) { clearTimeout(t); });
        timers = [];
        if (audio) { audio.close(); audio = null; }
      }

      /*
       * A plain triangle tone with a short envelope. Not an attempt at a brass
       * sound — the app has sampled instruments for that. This only has to be
       * clear enough to tell whether a tune is any good.
       */
      function play(theme, bpm) {
        stop();
        var Ctx = window.AudioContext || window.webkitAudioContext;
        audio = new Ctx();
        var secondsPerBeat = 60 / bpm;
        var start = audio.currentTime + 0.1;

        theme.notes.forEach(function (note) {
          var midi = note[0], at = note[1], beats = note[2];
          var osc = audio.createOscillator();
          var gain = audio.createGain();
          osc.type = 'triangle';
          osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
          var t0 = start + at * secondsPerBeat;
          var t1 = t0 + beats * secondsPerBeat * 0.92;
          gain.gain.setValueAtTime(0.0001, t0);
          gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
          gain.gain.setValueAtTime(0.22, Math.max(t0 + 0.03, t1 - 0.06));
          gain.gain.exponentialRampToValueAtTime(0.0001, t1);
          osc.connect(gain);
          gain.connect(audio.destination);
          osc.start(t0);
          osc.stop(t1 + 0.02);
        });

        var last = theme.notes[theme.notes.length - 1];
        var endsAt = (last[1] + last[2]) * secondsPerBeat * 1000 + 400;
        timers.push(setTimeout(stop, endsAt));
      }

      function show(id) {
        current = byId[id];
        if (!current) return;
        stop();
        document.getElementById('viewer').hidden = false;
        document.getElementById('viewer-name').textContent =
          current.name + ' — ' + current.difficulty + ', ' + current.metre + ', ' +
          current.bars + ' bars';
        var target = document.getElementById('score');
        target.innerHTML = '';
        var source = document.querySelector('#scores .score[data-id="' + id + '"]');
        if (source) target.appendChild(source.cloneNode(true)).hidden = false;
        document.getElementById('viewer').scrollIntoView({ block: 'start' });
      }

      var VERDICT_KEY = 'theme-verdicts';
      function verdicts() {
        try { return JSON.parse(localStorage.getItem(VERDICT_KEY) || '{}'); }
        catch (e) { return {}; }
      }
      function writeVerdicts(map) {
        localStorage.setItem(VERDICT_KEY, JSON.stringify(map));
        paint(map);
      }
      function paint(map) {
        Array.prototype.forEach.call(document.querySelectorAll('#index tr'), function (row) {
          row.classList.remove('keep', 'bin');
          var v = map[row.dataset.id];
          if (v) row.classList.add(v);
        });
        var binned = [], kept = [];
        Object.keys(map).forEach(function (id) {
          (map[id] === 'bin' ? binned : kept).push(id);
        });
        var lines = [];
        if (binned.length) lines.push('bin: ' + binned.join(', '));
        if (kept.length) lines.push('keep: ' + kept.join(', '));
        document.getElementById('verdicts').value =
          lines.length ? lines.join('\\n') : 'Nothing marked yet.';
      }

      document.getElementById('index').addEventListener('click', function (event) {
        var row = event.target.closest('tr');
        if (!row) return;
        if (event.target.classList.contains('open')) { show(row.dataset.id); return; }
        var verdict = event.target.dataset.verdict;
        if (!verdict) return;
        var map = verdicts();
        if (map[row.dataset.id] === verdict) delete map[row.dataset.id];
        else map[row.dataset.id] = verdict;
        writeVerdicts(map);
      });

      document.getElementById('play').addEventListener('click', function () {
        if (current) play(current, Number(document.getElementById('tempo').value));
      });
      document.getElementById('stop').addEventListener('click', stop);
      document.getElementById('tempo').addEventListener('input', function (event) {
        document.getElementById('bpm').textContent = event.target.value + ' bpm';
      });
      document.getElementById('copy').addEventListener('click', function () {
        var field = document.getElementById('verdicts');
        field.select();
        try { document.execCommand('copy'); } catch (e) { /* the user can select it */ }
      });
      document.getElementById('clear').addEventListener('click', function () {
        localStorage.removeItem(VERDICT_KEY);
        paint({});
      });

      paint(verdicts());
    </script>
  </body>
</html>
`;
}

/** What the published copy under `public/spike/` is generated with. */
export const PUBLISHED: ThemePageOptions = {
  instrumentId: 'eb-bass',
  clef: 'treble',
  fifths: -3,
  width: 1000,
};

export const PUBLISHED_PATH = 'public/spike/themes.html';
