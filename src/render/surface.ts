/**
 * The play surface, in either of two reading modes.
 *
 * **Scrolling** moves the music past a fixed strike line. The line says exactly
 * when to play, which makes it a good way to learn fingerings.
 *
 * **Paged** holds the music still and turns the page as the player approaches
 * the end of it. Nothing marks the beat but the metronome, so the player has to
 * count for themselves — which is what reading actually involves. The scrolling
 * line quietly does the hardest part of sight-reading for you.
 *
 * Both modes are the same drawing code with a different origin: scrolling
 * follows the playhead continuously, paged moves on a page at a time. Judging
 * is identical in both, since it works from scheduled beat times and never from
 * anything on screen.
 *
 * They differ in how the music is spaced, and they have to. Scrolling music is
 * spaced by how fast it should travel, so a beat is always the same distance —
 * uneven spacing would make it surge and stall as it crossed the strike line.
 * Paged music stands still and is engraved instead: room follows the notes
 * rather than the barlines, so a bar of semiquavers takes most of a line and a
 * bar holding one semibreve is short. See `spacing.ts`.
 *
 * Each frame reads the current beat from the transport — which reads the audio
 * clock — and positions everything from that. The render loop never accumulates
 * its own time, so a dropped frame costs a frame of smoothness and nothing else;
 * the notation cannot drift out of step with the sound.
 */

import { spellInKey } from '../domain/keys';
import { durationBeats } from '../domain/rhythm';
import type { SpelledPitch } from '../domain/pitch';
import type { Transport } from '../engine/clock';
import type { Verdict } from '../engine/judge';
import type { Exercise } from '../exercise/types';
import { drawBeamGroup, drawNote, drawRest, noteheadWidth, type LayoutNote } from './notes';
import { engraveSpacing, NOTE_CLEARANCE, type Spacing } from './spacing';
import {
  drawBarLine,
  drawClef,
  drawKeySignature,
  drawStaveLines,
  drawTimeSignature,
  measureStaveHeader,
  staveMetrics,
  type StaveMetrics,
} from './stave';

/** Floor on how little of the coming music may be visible, however narrow the screen. */
const MIN_BEATS_VISIBLE = 3;

/**
 * How close to the end of a page the playhead gets before the page turns.
 *
 * One bar, so the turn comes as the last visible bar is reached — about four
 * fifths of the way across a five-bar page. Turning earlier wastes the right
 * hand side of the screen and interrupts more often than it needs to; the cost
 * is a bar less warning in the moment before each turn, which the slide below
 * largely absorbs.
 */
const TURN_MARGIN_BARS = 1;

/**
 * How long the page takes to slide across, in milliseconds.
 *
 * A jump is cheaper and was what this did first, but it lands while the reader
 * is concentrating hardest and their eye has to hunt for its place again. A
 * slide keeps the notes continuous, so the eye is carried rather than reset.
 *
 * Fixed rather than derived from tempo: the view shifts several bars' worth of
 * distance in half a second, which outpaces the music comfortably at any
 * playable speed, so the note being read always moves left.
 */
const PAGE_TURN_MS = 550;

/** Gentle at both ends: zero velocity at the start and the finish. */
function easeInOut(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

/**
 * How far a bar line sits to the left of its downbeat, in stave spaces.
 *
 * Half a notehead clears the note itself; the rest is the gap an engraver would
 * leave, so the note reads as being *after* the bar line rather than on it.
 */
const BAR_LINE_SETBACK = 1.75;

/**
 * How long the strike line holds its confirming colour, in milliseconds.
 *
 * The only feedback a player can take in without looking away from the music,
 * and the only kind worth showing here: green, the instant the fingering comes
 * right, and nothing at all otherwise.
 *
 * A verdict cannot be known until the timing window closes, which can be most
 * of a note later. Shown then, a red flash no longer points at anything the
 * player can place — and arriving near the following note, it reads as a cue to
 * play it. Confirmation lands on the act that earned it or it does not belong
 * on screen; the notes that went wrong are dealt with afterwards, where there
 * is time to look.
 *
 * Short and sharp: long enough to register at the edge of vision, over well
 * before the next note at any playable tempo.
 */
const CORRECT_FLASH_MS = 320;

export type ReadingMode = 'scrolling' | 'paged';

export interface StaveTheme {
  background: string;
  stave: string;
  note: string;
  upcoming: string;
  correct: string;
  wrong: string;
  missed: string;
  strikeLine: string;
  strikeGlow: string;
  countIn: string;
}

export const LIGHT_THEME: StaveTheme = {
  background: '#fbfaf7',
  stave: '#3b3a36',
  note: '#16150f',
  upcoming: '#16150f',
  correct: '#1a7f4b',
  wrong: '#c02b2b',
  missed: '#b7791f',
  strikeLine: '#2f6fd0',
  strikeGlow: 'rgba(47, 111, 208, 0.10)',
  countIn: 'rgba(22, 21, 15, 0.35)',
};

export const DARK_THEME: StaveTheme = {
  background: '#16171b',
  stave: '#8d8f96',
  note: '#f2f1ec',
  upcoming: '#f2f1ec',
  correct: '#4ade80',
  wrong: '#f87171',
  missed: '#fbbf24',
  strikeLine: '#63a1ff',
  strikeGlow: 'rgba(99, 161, 255, 0.14)',
  countIn: 'rgba(242, 241, 236, 0.35)',
};

/** The theme matching the system colour scheme. */
export function currentTheme(): StaveTheme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? DARK_THEME : LIGHT_THEME;
}

export function verdictColour(verdict: Verdict | undefined, theme: StaveTheme): string {
  switch (verdict) {
    case 'correct':
      return theme.correct;
    case 'wrong':
      return theme.wrong;
    case 'missed':
      return theme.missed;
    default:
      return theme.upcoming;
  }
}

export interface StaveRendererOptions {
  canvas: HTMLCanvasElement;
  exercise: Exercise;
  transport: Transport;
  theme: StaveTheme;
  /**
   * How fast the music travels, in pixels per second.
   *
   * The eye tracks absolute motion, so this is the thing that decides whether
   * notation is comfortable to read — not how far apart the notes are.
   *
   * Setting the spacing instead, and letting the speed fall out of it, ties the
   * two together in a way that always disappoints somewhere: a larger stave
   * makes the notes clearer *and* faster, so fixing legibility on a wide screen
   * spoils the tracking. Fixing the speed and letting spacing fall out inverts
   * that. The music reads at one rate on every device and at every tempo; a
   * bigger screen shows more of it, which is what a bigger screen is for.
   */
  scrollSpeed: number;
  readingMode: ReadingMode;
  verdictFor: (noteIndex: number) => Verdict | undefined;
}

export class StaveRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly spellings: SpelledPitch[];
  /** Shortest note in this exercise, which sets how tight the spacing may go. */
  private readonly shortestNoteBeats: number;
  private frame: number | null = null;
  private metrics: StaveMetrics;
  private headerWidth = 0;
  private strikeX = 0;
  private width = 0;
  private height = 0;
  /** Scrolling mode's constant scale; see `layout`. */
  private pixelsPerBeat = 100;
  /**
   * Paged mode's engraved spacing, where the scale is not constant at all.
   * Null while scrolling, which is spaced by speed instead.
   */
  private spacing: Spacing | null = null;
  /** Paged mode only: the first bar currently on screen. */
  private pageStartBar = 0;
  /** Latest bar a page may begin on; settled by `layout`, not per frame. */
  private lastPageStartBar = 0;
  /**
   * Distance into the music drawn at the left edge, in pixels; lags during a
   * page turn. Pixels rather than beats because the beat-to-pixel map is not
   * linear in paged mode, and easing a beat through it would make the page
   * lurch rather than glide.
   */
  private shownOrigin = 0;
  private slideTarget = 0;
  private slide: { from: number; to: number; startedAt: number } | null = null;
  /** When the last confirmation landed, on the wall clock. */
  private flash: number | null = null;

  private options: StaveRendererOptions;

  constructor(options: StaveRendererOptions) {
    this.options = options;
    const ctx = options.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;

    // Spelling depends only on pitch and key, so it is settled once rather than
    // recomputed for every note on every frame.
    this.spellings = options.exercise.notes.map((n) => spellInKey(n.writtenMidi, options.exercise.fifths));
    this.shortestNoteBeats = options.exercise.notes.reduce(
      (shortest, note) => Math.min(shortest, durationBeats(note.duration)),
      1,
    );
    this.metrics = staveMetrics(options.exercise.clef, 0, 10);
    this.resize();
  }

  setTheme(theme: StaveTheme): void {
    this.options = { ...this.options, theme };
  }

  /** The current horizontal scale. Exposed for tests and for debugging layout. */
  get scale(): {
    /** Constant while scrolling; the average across the exercise when paged. */
    pixelsPerBeat: number;
    strikeX: number;
    staveSpace: number;
    beatsVisible: number;
    barsPerPage: number;
    pageStartBar: number;
    /** Pixels into the music at the left edge — mid-slide this sits between pages. */
    shownOrigin: number;
    /** Where the current page begins, which is where a slide is heading. */
    pageOrigin: number;
  } {
    const reading = this.width - this.strikeX;
    return {
      pixelsPerBeat: this.spacing?.averagePixelsPerBeat ?? this.pixelsPerBeat,
      strikeX: this.strikeX,
      staveSpace: this.metrics.staveSpace,
      beatsVisible: this.spacing
        ? this.spacing.beatAt(this.pageOrigin() + reading) -
          this.spacing.beatAt(this.pageOrigin())
        : reading / this.pixelsPerBeat,
      barsPerPage: this.barsPerPage(),
      pageStartBar: this.pageStartBar,
      shownOrigin: this.shownOrigin,
      pageOrigin: this.pageOrigin(),
    };
  }

  /**
   * Confirms that a note has been fingered correctly, pulsing the strike line.
   *
   * Driven from outside rather than watched for, because the renderer has no
   * way of knowing when this happens: `verdictFor` is a lookup it polls every
   * frame, and polling cannot tell a fresh answer from an old one.
   */
  flashCorrect(): void {
    this.flash = performance.now();
  }

  /** Strength of the current pulse, 0 when there is none. Exposed for tests. */
  get correctFlash(): number {
    if (this.flash === null) return 0;
    const progress = (performance.now() - this.flash) / CORRECT_FLASH_MS;
    if (progress >= 1) {
      this.flash = null;
      return 0;
    }
    // Squared decay: bright on arrival, then out of the way quickly.
    return (1 - Math.max(0, progress)) ** 2;
  }

  setScrollSpeed(scrollSpeed: number): void {
    this.options = { ...this.options, scrollSpeed };
    this.layout();
  }

  resize(): void {
    const { canvas } = this.options;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);

    // Bail out when nothing actually changed. Resizing the backing store is not
    // free, and a ResizeObserver that reacts to its own effect would thrash.
    if (width === this.width && height === this.height) return;

    const dpr = window.devicePixelRatio || 1;
    this.width = width;
    this.height = height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.layout();
  }

  private layout(): void {
    // Scaled by width as well as height. Sizing on height alone leaves the clef,
    // key and time signature eating most of a narrow screen, which is exactly
    // the space the player needs for seeing what is coming.
    //
    // The height term and the ceiling are what a landscape screen runs into, and
    // both are set generously: a wide screen was otherwise showing tiny notes
    // and half a page of music nobody was going to read that far ahead. Since
    // note spacing is a multiple of the stave size, enlarging the stave also
    // brings the horizon in — one lever does both.
    const staveSpace = Math.min(30, this.height / 11, this.width / 30);
    this.metrics = staveMetrics(
      this.options.exercise.clef,
      this.height / 2 - 2 * Math.max(6, staveSpace),
      Math.max(6, staveSpace),
    );

    const { exercise } = this.options;
    this.headerWidth =
      measureStaveHeader(this.metrics, exercise.fifths, exercise.beatsPerBar, exercise.beatUnit) +
      this.metrics.staveSpace;

    // Sit the strike line just past the header rather than a further slice of
    // the width; everything to its right is reading time.
    this.strikeX = this.headerWidth + this.metrics.staveSpace * 1.5;

    const paged = this.options.readingMode === 'paged';

    // The least room the shortest note in this exercise can be given without
    // colliding with its neighbour. The floor under both modes.
    const head = noteheadWidth(this.metrics, { value: 'quarter', dotted: false });
    const forLegibility = (head * NOTE_CLEARANCE) / this.shortestNoteBeats;

    /*
     * Scrolling music is spaced by how fast it should travel; paged music is
     * not spaced by anything of the sort.
     *
     * Nothing on a page moves, so neither the tempo nor the reading speed has
     * any bearing on how it is set. A printed part is engraved: room follows
     * the notes rather than the barlines, so a bar of semiquavers takes most of
     * a line and a bar holding one semibreve is short. Uniform spacing gave the
     * whole exercise the spacing its busiest bar needed, which on anything but
     * a study in even notes wastes most of the page.
     */
    if (paged) {
      this.spacing = engraveSpacing(exercise, {
        minColumnWidth: head * NOTE_CLEARANCE,
        // A page is measured in bars, so at least one whole bar has to fit.
        maxBarWidth: this.width - this.strikeX - this.metrics.staveSpace,
      });
      this.pixelsPerBeat = this.spacing.averagePixelsPerBeat;
      this.lastPageStartBar = this.findLastPageStart();
      return;
    }

    this.spacing = null;

    // A narrow screen cannot honour the speed without leaving almost no warning
    // of what is coming, so tighten just enough to keep a bar or so in view.
    const forMinimumLookahead = (this.width - this.strikeX) / MIN_BEATS_VISIBLE;
    const forSpeed = this.options.scrollSpeed * this.options.transport.secondsPerBeat;

    this.pixelsPerBeat = Math.max(
      8,
      Math.min(Math.max(forSpeed, forLegibility), forMinimumLookahead),
    );
    this.lastPageStartBar = this.findLastPageStart();
  }

  /** Whole bars that fit to the right of the header, from the current page. */
  private barsPerPage(): number {
    return this.barsFrom(this.pageStartBar, this.width - this.strikeX - this.metrics.staveSpace);
  }

  /** Distance into the music at the left edge, in pixels. */
  private xAt(beat: number): number {
    return this.spacing ? this.spacing.xOf(beat) : beat * this.pixelsPerBeat;
  }

  /** Where the current page begins, ignoring any slide in progress. */
  private pageOrigin(): number {
    return this.xAt(this.pageStartBar * this.options.exercise.beatsPerBar);
  }

  /**
   * The position sitting at the left of the display, in pixels into the music.
   *
   * Scrolling mode tracks the playhead exactly. Paged mode holds still and then
   * moves on, leaving the bar being played at the left edge — the same thing a
   * player does turning a page, and it keeps the current bar visible rather than
   * replacing it with music that has not been reached yet.
   */
  private originX(beat: number): number {
    if (this.options.readingMode === 'scrolling') return this.xAt(beat);

    const { beatsPerBar } = this.options.exercise;
    const currentBar = Math.max(0, Math.floor(beat / beatsPerBar));

    if (currentBar < this.pageStartBar) {
      // Counted in, or restarted.
      this.pageStartBar = currentBar;
    } else if (currentBar >= this.pageStartBar + Math.max(1, this.barsPerPage() - TURN_MARGIN_BARS)) {
      this.pageStartBar = currentBar;
    }

    // Never start a page so late that it holds less than it could: at the end
    // of the exercise, back up until the remaining bars fill the screen.
    this.pageStartBar = Math.min(this.pageStartBar, this.lastPageStartBar);

    return this.slideTowards(this.pageOrigin());
  }

  /**
   * The latest bar a page may begin on.
   *
   * With even spacing this was simply the total less a page's worth. Engraved,
   * the last page holds however many bars happen to fit, so it has to be
   * searched for — walking back while the tail still fits on one screen. Done
   * once per layout rather than per frame, since only the geometry decides it.
   */
  private findLastPageStart(): number {
    const { beatsPerBar, totalBeats } = this.options.exercise;
    const totalBars = Math.max(1, Math.ceil(totalBeats / beatsPerBar));
    const usable = this.width - this.strikeX - this.metrics.staveSpace;

    let start = totalBars - 1;
    while (start > 0 && this.barsFrom(start - 1, usable) >= totalBars - (start - 1)) start--;
    return Math.max(0, start);
  }

  /**
   * Whole bars that fit in `usable` pixels starting at `bar`.
   *
   * Engraved pages hold a different number depending on where they start, which
   * is exactly the point; evenly spaced ones do not, and never needed asking.
   */
  private barsFrom(bar: number, usable: number): number {
    if (!this.spacing) {
      const perBar = this.options.exercise.beatsPerBar * this.pixelsPerBeat;
      return Math.max(1, Math.floor(usable / perBar));
    }
    return this.spacing.barsFitting(bar, usable);
  }

  /**
   * Eases the display towards a new page rather than cutting to it.
   *
   * A turn arriving mid-bar is the worst possible moment to make someone find
   * their place again, so the music slides instead. A turn that begins while
   * one is already running starts from wherever the slide has reached, so the
   * two never compound into a jump.
   */
  private slideTowards(target: number): number {
    if (target !== this.slideTarget) {
      this.slide = { from: this.shownOrigin, to: target, startedAt: performance.now() };
      this.slideTarget = target;
    }

    if (!this.slide) {
      this.shownOrigin = target;
      return target;
    }

    const progress = (performance.now() - this.slide.startedAt) / PAGE_TURN_MS;
    if (progress >= 1) {
      this.shownOrigin = this.slide.to;
      this.slide = null;
    } else {
      const { from, to } = this.slide;
      this.shownOrigin = from + (to - from) * easeInOut(Math.max(0, progress));
    }
    return this.shownOrigin;
  }

  start(): void {
    if (this.frame !== null) return;
    const loop = () => {
      this.draw();
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  /** Renders a single frame; also used to show a static preview before starting. */
  draw(): void {
    const { ctx } = this;
    const { theme, exercise, transport } = this.options;
    // Interpolated rather than raw, so scrolling is smooth between audio ticks.
    const beat = transport.visualBeat();
    const origin = this.originX(beat);

    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, this.width, this.height);

    const xForBeat = (b: number) => this.strikeX + this.xAt(b) - origin;

    // Scrolling content is clipped so it slides under the fixed header rather
    // than over it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.headerWidth, 0, this.width - this.headerWidth, this.height);
    ctx.clip();

    ctx.strokeStyle = theme.stave;
    drawStaveLines(ctx, this.metrics, this.headerWidth, this.width);

    ctx.strokeStyle = theme.stave;
    for (let bar = 0; bar * exercise.beatsPerBar <= exercise.totalBeats; bar++) {
      const x = xForBeat(bar * exercise.beatsPerBar);
      if (x < this.headerWidth - 20 || x > this.width + 20) continue;
      // Set back from the beat rather than on it. A note is positioned by its
      // centre, so a downbeat drawn at the same x puts the notehead astride the
      // bar line; engraved music always leaves the note clear of it. The line
      // moves and the note does not, because the note's position is what the
      // strike line is timed against.
      drawBarLine(ctx, this.metrics, x - BAR_LINE_SETBACK * this.metrics.staveSpace, false);
    }

    for (const rest of exercise.rests) {
      const x = xForBeat(rest.startBeat);
      if (x < -60 || x > this.width + 60) continue;
      drawRest(ctx, this.metrics, x, rest.duration, theme.stave);
    }

    this.drawNotes(xForBeat);
    ctx.restore();

    // No strike line in paged mode — a marker showing where the beat has got to
    // would give away the very thing the player is meant to be working out.
    if (this.options.readingMode === 'scrolling') this.drawStrikeLine();
    this.drawHeader();
    if (beat < 0) this.drawCountIn(beat);
  }

  private drawNotes(xForBeat: (beat: number) => number): void {
    const { exercise, theme } = this.options;
    const layout: LayoutNote[] = [];
    const groups = new Map<number, LayoutNote[]>();

    exercise.notes.forEach((note, index) => {
      const x = xForBeat(note.startBeat);
      if (x < -80 || x > this.width + 80) return;

      const headWidth = noteheadWidth(this.metrics, note.duration);
      const item: LayoutNote = {
        // Centre the notehead on the beat, so it meets the strike line squarely.
        x: x - headWidth / 2,
        pitch: this.spellings[index],
        duration: note.duration,
        showAccidental: note.showAccidental,
        colour: verdictColour(this.options.verdictFor(index), theme),
      };

      if (note.beamGroup >= 0) {
        const group = groups.get(note.beamGroup) ?? [];
        group.push(item);
        groups.set(note.beamGroup, group);
      } else {
        layout.push(item);
      }
    });

    for (const note of layout) drawNote(this.ctx, this.metrics, note);
    for (const group of groups.values()) drawBeamGroup(this.ctx, this.metrics, group);
  }

  private drawStrikeLine(): void {
    const { ctx } = this;
    const { theme } = this.options;
    const glowWidth = Math.max(8, this.metrics.staveSpace * 1.2);
    const flash = this.correctFlash;
    const top = this.metrics.topLineY - this.metrics.staveSpace * 2.5;
    const bottom = this.metrics.bottomLineY + this.metrics.staveSpace * 2.5;

    ctx.fillStyle = theme.strikeGlow;
    ctx.fillRect(this.strikeX - glowWidth / 2, 0, glowWidth, this.height);

    /*
     * Confirmation, where the player is already looking.
     *
     * A widening band rather than a brighter one: peripheral vision picks up
     * movement far more readily than colour, so the spread is what catches the
     * eye and the colour is what it finds when it gets there.
     */
    if (flash > 0) {
      const spread = glowWidth * (1 + 2.5 * flash);
      ctx.save();
      ctx.fillStyle = theme.correct;
      ctx.globalAlpha = 0.4 * flash;
      ctx.fillRect(this.strikeX - spread / 2, 0, spread, this.height);
      ctx.restore();
    }

    ctx.save();
    if (flash > 0) {
      ctx.strokeStyle = theme.correct;
      ctx.lineWidth = 2 + 3 * flash;
    } else {
      ctx.strokeStyle = theme.strikeLine;
      ctx.lineWidth = 2;
    }
    ctx.beginPath();
    ctx.moveTo(Math.round(this.strikeX) + 0.5, top);
    ctx.lineTo(Math.round(this.strikeX) + 0.5, bottom);
    ctx.stroke();
    ctx.restore();
  }

  private drawHeader(): void {
    const { ctx } = this;
    const { theme, exercise } = this.options;

    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, this.headerWidth, this.height);

    ctx.strokeStyle = theme.stave;
    ctx.fillStyle = theme.stave;
    drawStaveLines(ctx, this.metrics, 0, this.headerWidth);

    let x = this.metrics.staveSpace * 0.4;
    x = drawClef(ctx, this.metrics, x);
    x = drawKeySignature(ctx, this.metrics, x, exercise.fifths);
    drawTimeSignature(ctx, this.metrics, x, exercise.beatsPerBar, exercise.beatUnit);
  }

  private drawCountIn(beat: number): void {
    const { ctx } = this;
    const remaining = Math.ceil(-beat);
    ctx.fillStyle = this.options.theme.countIn;
    ctx.font = `600 ${Math.round(this.height * 0.4)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(remaining), this.width / 2, this.height / 2);
  }
}
