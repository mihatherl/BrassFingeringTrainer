/**
 * A canvas 2D context that emits SVG.
 *
 * The stave renderer targets a canvas, but everything it asks of one is a
 * shape: rectangles, straight lines, quadratic curves, and glyph outlines that
 * were SVG path data before they were Path2D. So the dozen methods it actually
 * calls can be answered with SVG directly, and what comes out is the same
 * geometry the app draws rather than a redrawing of it.
 *
 * For looking at engraving during development. Not part of the app.
 */

export class SvgPath2D {
  readonly d: string;

  // Written out rather than as a constructor parameter property, which
  // `erasableSyntaxOnly` forbids — that flag is what keeps these files
  // runnable by anything that only strips types.
  constructor(d = '') {
    this.d = d;
  }
}

/** The slice of a 2D context the stave renderer uses, emitting SVG as it goes. */
export class SvgContext {
  readonly out: string[] = [];
  private stack: string[] = [];
  private transform = '';

  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  font = '';
  textAlign = 'left';
  textBaseline = 'alphabetic';

  private path: string[] = [];

  save(): void {
    this.stack.push(this.transform);
  }

  restore(): void {
    this.transform = this.stack.pop() ?? '';
  }

  translate(x: number, y: number): void {
    this.transform += ` translate(${x} ${y})`;
  }

  scale(x: number, y: number): void {
    this.transform += ` scale(${x} ${y})`;
  }

  private wrap(element: string): string {
    return this.transform ? `<g transform="${this.transform.trim()}">${element}</g>` : element;
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    // Negative extents are legal on a canvas and are how beams are drawn.
    const [left, width] = w < 0 ? [x + w, -w] : [x, w];
    const [top, height] = h < 0 ? [y + h, -h] : [y, h];
    this.out.push(
      this.wrap(`<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="${this.fillStyle}"/>`),
    );
  }

  beginPath(): void {
    this.path = [];
  }

  moveTo(x: number, y: number): void {
    this.path.push(`M${x} ${y}`);
  }

  lineTo(x: number, y: number): void {
    this.path.push(`L${x} ${y}`);
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.path.push(`Q${cx} ${cy} ${x} ${y}`);
  }

  closePath(): void {
    this.path.push('Z');
  }

  /** Enough of it for the fingering callout's capsule: one uniform radius. */
  roundRect(x: number, y: number, w: number, h: number, r: number): void {
    this.path.push(
      `M${x + r} ${y}`,
      `H${x + w - r}`,
      `A${r} ${r} 0 0 1 ${x + w} ${y + r}`,
      `V${y + h - r}`,
      `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
      `H${x + r}`,
      `A${r} ${r} 0 0 1 ${x} ${y + h - r}`,
      `V${y + r}`,
      `A${r} ${r} 0 0 1 ${x + r} ${y}`,
      'Z',
    );
  }

  stroke(): void {
    this.out.push(
      this.wrap(
        `<path d="${this.path.join(' ')}" fill="none" stroke="${this.strokeStyle}" stroke-width="${this.lineWidth}"/>`,
      ),
    );
  }

  fill(path?: SvgPath2D): void {
    const d = path ? path.d : this.path.join(' ');
    this.out.push(this.wrap(`<path d="${d}" fill="${this.fillStyle}"/>`));
  }

  fillText(text: string, x: number, y: number): void {
    const anchor = this.textAlign === 'center' ? 'middle' : this.textAlign === 'right' ? 'end' : 'start';
    // Only the two the renderer actually asks for; anything else is the
    // alphabetic default, which is what SVG does anyway.
    const baseline =
      this.textBaseline === 'middle'
        ? ' dominant-baseline="central"'
        : this.textBaseline === 'top'
          ? ' dominant-baseline="hanging"'
          : '';
    // The renderer sets its own font; fall back to something legible if not.
    const font = this.font || '500 12px sans-serif';
    this.out.push(
      this.wrap(
        `<text x="${x}" y="${y}" style="font: ${font}" text-anchor="${anchor}"${baseline} fill="${this.fillStyle}">${text}</text>`,
      ),
    );
  }

  measureText(text: string) {
    return { width: text.length * 7 };
  }
}
