/**
 * Drives the real app in a real browser and photographs it, at the sizes that
 * actually decide the layout.
 *
 * This exists because the suite cannot see the play screen. Its whole geometry
 * comes from `staveSpaceCeiling` against the viewport, and the faults that have
 * got through here were all *positional* — notes drawn below the last stave, a
 * notehead clipped by the left edge — which every passing test was blind to
 * because they measure notes relative to each other. The engraving snapshots
 * cover the notation; nothing but a browser covers the page around it.
 *
 * It was a throwaway script rebuilt from memory each time before this, so the
 * viewport list — the part worth keeping — was rewritten each time too.
 *
 *   npm run shots                      every viewport, both screens
 *   npm run shots -- --tier free       the gated build's settings screen
 *   npm run shots -- --theme dark
 *   npm run shots -- --viewport phone-landscape --screen play
 *   npm run shots -- --url http://localhost:5173
 *
 * The output is *not* committed and is not a snapshot: screenshots vary with
 * the host's fonts and GPU, so diffing them across machines would cry wolf. The
 * committed byte-for-byte check is the SVG one in `engraving.test.ts`. These
 * are for looking at.
 */

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright-core';

/**
 * Sizes chosen against the breakpoints in `index.css`, not from a device list.
 *
 * The rule that matters is `(orientation: landscape) and (max-height: 32rem)` —
 * sideways *and short*, meaning a phone on its side and nothing else. A tablet
 * turned sideways and a desktop window are both landscape with height to
 * spare, and they took the phone's concessions for a long time, most visibly
 * losing the conductor on a monitor. So both sides of that line are here.
 *
 * There is deliberately nothing near 32rem: the CSS says a phone sideways tops
 * out around 27rem and the smallest tablet has 46rem, so the line sits in open
 * country and a viewport placed on it would be testing a case no device is in.
 */
const VIEWPORTS: ReadonlyArray<{
  name: string;
  width: number;
  height: number;
  touch: boolean;
  why: string;
}> = [
  { name: 'phone-portrait', width: 390, height: 844, touch: true, why: 'The common case, and where the conductor is allowed.' },
  { name: 'phone-landscape', width: 844, height: 390, touch: true, why: 'Sideways and short: the stave is sized by height and the conductor is off.' },
  { name: 'tablet-portrait', width: 820, height: 1180, touch: true, why: 'Room for everything.' },
  { name: 'tablet-landscape', width: 1180, height: 820, touch: true, why: 'Landscape with height to spare — takes the roomy rule, not the phone one.' },
  { name: 'desktop', width: 1440, height: 900, touch: false, why: 'The wide layout rebuilt in 1.5. The one that is not a touch device.' },
];

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

/**
 * Starts the dev server and waits for it to say where it is listening.
 *
 * The port is read from its output rather than assumed, because Vite moves off
 * 5173 when something already has it and screenshotting the *other* thing on
 * 5173 would be a confusing way to find that out.
 *
 * `detached` is load-bearing, and this hung without it. `npm run dev` is a
 * shell wrapping the Vite process, and a signal sent to the wrapper is not
 * passed on — so Vite survived, held its end of the pipes open, and Node had a
 * live handle it would never see closed. Every screenshot had already been
 * taken by then, which is the confusing part: the script did its whole job and
 * then sat there. Its own process group means the signal reaches both, and the
 * streams are dropped so nothing is left keeping the loop alive.
 */
async function startDevServer(): Promise<{ url: string; stop: () => void }> {
  const child = spawn('npm', ['run', 'dev'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const stop = () => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Already gone, which is the outcome wanted anyway.
    }
    child.stdout?.destroy();
    child.stderr?.destroy();
  };

  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dev server did not start within 30s')), 30_000);
    child.stdout.on('data', (chunk: Buffer) => {
      const found = /(http:\/\/localhost:\d+\/?)/.exec(chunk.toString());
      if (found) {
        clearTimeout(timer);
        resolve(found[1]);
      }
    });
    child.on('exit', (code) => reject(new Error(`dev server exited with ${code}`)));
  });

  return { url, stop };
}

/**
 * Clicks through the settings screen and the play screen's start gate.
 *
 * The gate is a real gate: the instrument's samples are still loading behind it
 * and the button says so, so this waits for the button to offer to start rather
 * than clicking whatever is under the cursor.
 */
async function enterPlay(page: import('playwright-core').Page): Promise<void> {
  await page.getByRole('button', { name: 'Start' }).click();
  const gate = page.getByRole('button', { name: 'Tap to start' });
  await gate.waitFor({ state: 'visible', timeout: 30_000 });
  await gate.click();

  // Past the count-in and a couple of notes in, so the notation is moving and
  // the recent-notes list has something in it. There is nothing to wait *for*
  // here — the screen is a running animation, not a state that settles.
  await page.waitForTimeout(Number(arg('settle', '3500')));
}

async function shoot(browser: Browser, base: string, out: string): Promise<void> {
  const wanted = arg('viewport', '');
  const screens = arg('screen', 'both');
  const theme = arg('theme', 'light') === 'dark' ? 'dark' : 'light';
  const tier = arg('tier', '');
  const url = tier ? `${base}?tier=${tier}` : base;

  for (const viewport of VIEWPORTS) {
    if (wanted && viewport.name !== wanted) continue;

    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: theme,
      // A phone's pixels, so the notation is judged at the density it is read
      // at rather than at a desktop's.
      deviceScaleFactor: 2,
      // The valve pad is offered either way, but a desktop is the one place a
      // pointer really exists, and hover styling belongs in that picture only.
      hasTouch: viewport.touch,
      isMobile: viewport.touch,
    });
    const page = await context.newPage();
    const suffix = [theme === 'dark' ? 'dark' : '', tier ? `tier-${tier}` : ''].filter(Boolean).join('-');
    const stem = `${out}/${viewport.name}${suffix ? `-${suffix}` : ''}`;

    await page.goto(url, { waitUntil: 'networkidle' });

    if (screens !== 'play') {
      await page.screenshot({ path: `${stem}-settings.png` });
      process.stdout.write(`${stem}-settings.png\n`);
    }

    if (screens !== 'settings') {
      await enterPlay(page);
      await page.screenshot({ path: `${stem}-play.png` });
      process.stdout.write(`${stem}-play.png\n`);

      // Whatever went wrong, it is worth naming here rather than leaving
      // someone to notice it in the picture afterwards.
      const stalled = await page.getByText('Audio didn’t start').isVisible().catch(() => false);
      if (stalled) process.stderr.write(`  ${viewport.name}: audio stalled — this is the gate, not the play screen\n`);
    }

    await context.close();
  }
}

const out = arg('out', 'shots');
await mkdir(out, { recursive: true });

const given = arg('url', '');
const server = given ? null : await startDevServer();
const base = given || server!.url;

let browser: Browser | undefined;
try {
  browser = await chromium.launch();
} catch (cause) {
  server?.stop();
  throw new Error(
    'Could not launch Chromium. playwright-core does not download browsers — run `npx playwright install chromium`.',
    { cause },
  );
}

try {
  await shoot(browser, base, out);
} finally {
  await browser.close();
  server?.stop();
}
