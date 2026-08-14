// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from './App';

/**
 * An end-to-end check that the app mounts and the screens wire together.
 *
 * It stops at the "Tap to start" gate — everything past that needs a real
 * AudioContext — but it covers the parts a unit test cannot: that settings
 * changes reach the generator, that starting builds a playable exercise, and
 * that instrument and clef stay consistent with one another.
 */

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the app', () => {
  it('opens on the settings screen', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /brass fingering trainer/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
  });

  it('starts an exercise and shows the valve pad', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    // The audio gate comes first, since browsers will not start sound without
    // a gesture.
    expect(screen.getByRole('button', { name: /tap to start/i })).toBeTruthy();
  });

  it('offers bass clef only for the instruments that read it', () => {
    render(<App />);
    const instrument = screen.getByLabelText<HTMLSelectElement>('Instrument');

    fireEvent.change(instrument, { target: { value: 'cornet' } });
    // The one button left is the whole explanation; there used to be a line of
    // prose beside it saying so, which said nothing the control did not.
    expect(screen.queryByRole('button', { name: 'Bass' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Treble' })).toBeTruthy();

    fireEvent.change(instrument, { target: { value: 'euphonium' } });
    expect(screen.getByRole('button', { name: 'Bass' })).toBeTruthy();
  });

  it('shows a written range that follows the instrument and clef', () => {
    render(<App />);
    const instrument = screen.getByLabelText<HTMLSelectElement>('Instrument');

    fireEvent.change(instrument, { target: { value: 'cornet' } });
    const cornetRange = screen.getByText(/^Written range/).textContent;

    fireEvent.change(instrument, { target: { value: 'eb-bass' } });
    const ebBassRange = screen.getByText(/^Written range/).textContent;

    // Both read treble clef, but their written compasses differ.
    expect(cornetRange).not.toEqual(ebBassRange);

    fireEvent.click(screen.getByRole('button', { name: 'Bass' }));
    const bassClefRange = screen.getByText(/^Written range/).textContent;
    expect(bassClefRange).toContain('concert pitch');
    expect(bassClefRange).not.toEqual(ebBassRange);
  });

  it('remembers settings across a reload', () => {
    const first = render(<App />);
    fireEvent.change(screen.getByLabelText<HTMLSelectElement>('Instrument'), {
      target: { value: 'cornet' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Hard' }));
    first.unmount();

    render(<App />);
    expect(screen.getByLabelText<HTMLSelectElement>('Instrument').value).toBe('cornet');
    expect(screen.getByRole('button', { name: 'Hard' }).className).toContain('is-selected');
  });

  it('starts with every section shut, every time', () => {
    /*
     * The screen is long and collapsing it is the point. What is set shows on
     * each shut section's summary line, so arriving at a screen of headings
     * loses nothing — and coming back from a run no longer means arriving at
     * whatever happened to be open when you left, which was usually all of it.
     */
    render(<App />);
    const panels = [...document.querySelectorAll<HTMLDetailsElement>('details.panel')];

    expect(panels.length).toBeGreaterThan(3);
    expect(panels.filter((panel) => panel.open)).toHaveLength(0);
  });

  it('says what is selected in each collapsed section', () => {
    render(<App />);
    const valuesOf = (title: string) =>
      [...document.querySelectorAll<HTMLDetailsElement>('details.panel')]
        .find((panel) => panel.querySelector('.panel__title')?.textContent === title)
        ?.querySelector('.panel__values')?.textContent;

    // The defaults: Eb bass in treble, Eb major, sight-reading, Easy.
    expect(valuesOf('Instrument')).toBe('Eb Bass (Tuba) · Treble');
    expect(valuesOf('Exercise')).toBe('Eb major · Sight-reading · Easy');
    expect(valuesOf('Playing')).toBe('Scrolling line · Play the notes · metronome');
    // Advanced says nothing until something in it has been moved off its
    // default, rather than reciting the settings the app came with.
    expect(valuesOf('Advanced')).toBe('');
  });

  it('keeps the tempo out of the panels, where it can be reached in one tap', () => {
    /*
     * The one setting a player changes every single time — the same exercise
     * slower is most of what practice is — and it used to be two taps down
     * inside a collapsed section, beneath things chosen once and left alone.
     */
    render(<App />);
    const tempo = screen.getByLabelText(/^Tempo/);
    expect(tempo.closest('details.panel')).toBeNull();
    expect(tempo.closest('.actions--sticky')).not.toBeNull();
  });

  it('hides the scroll speed in the mode where it does nothing', () => {
    // Paged reading engraves the music standing still; `layout` returns before
    // the speed is read. A slider that moves nothing is worse than no slider.
    render(<App />);
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByLabelText(/^Scroll speed/)).toBeTruthy();

    fireEvent.click(screen.getByText('Playing'));
    fireEvent.click(screen.getByRole('button', { name: /Read the page/ }));
    expect(screen.queryByLabelText(/^Scroll speed/)).toBeNull();
  });

  it('keeps the summary in step with what is chosen', () => {
    render(<App />);
    const exerciseValues = () =>
      [...document.querySelectorAll<HTMLDetailsElement>('details.panel')]
        .find((panel) => panel.querySelector('.panel__title')?.textContent === 'Exercise')
        ?.querySelector('.panel__values')?.textContent;

    fireEvent.click(screen.getByRole('button', { name: /Scales/ }));

    // Choosing scales relabels the difficulty buttons by how far the pattern
    // reaches, so "Hard" is no longer called Hard.
    expect(screen.queryByRole('button', { name: 'Hard' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '2 oct · mixed' }));

    // And the summary has to follow suit, or it contradicts the button above it.
    expect(exerciseValues()).toBe('Eb major · Scales · 2 oct · mixed');
  });

  it('keeps collapsed sections reachable to assistive technology and search', () => {
    // `<details>` keeps its contents in the document, which is why the controls
    // below are still found even while their section is shut.
    render(<App />);
    expect(screen.getByLabelText('Instrument')).toBeTruthy();
    expect(screen.getByText(/Timing tolerance/)).toBeTruthy();
  });

  describe('choosing keys', () => {
    /*
     * One control, not two. There used to be a dropdown naming the starting key
     * beside a grid naming the keys in play, which said the same thing twice —
     * `keySet[0]` is the starting key and always was.
     */
    const key = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name} major`) });
    const exerciseValues = () =>
      [...document.querySelectorAll<HTMLDetailsElement>('details.panel')]
        .find((panel) => panel.querySelector('.panel__title')?.textContent === 'Exercise')
        ?.querySelector('.panel__values')?.textContent;

    it('starts in the first key chosen, and says the whole route', () => {
      render(<App />);
      fireEvent.click(screen.getByText('Exercise'));

      // Eb is the default and the only one selected, so it is the start.
      expect(exerciseValues()).toContain('Eb major');

      fireEvent.click(key('Bb'));
      fireEvent.click(key('F'));
      // Ordered for playing by closeness from the opening key, not by the order
      // they were tapped — but Eb still leads, because it was chosen first.
      expect(exerciseValues()).toContain('Eb → Bb → F');
    });

    it('will not let the last key be turned off', () => {
      // An exercise has to be in some key. With one chosen there is nothing to
      // deselect, which is the whole of the rule — no separate starting key to
      // protect, as there was when two controls had to be kept agreeing.
      render(<App />);
      fireEvent.click(screen.getByText('Exercise'));
      expect(key('Eb')).toHaveProperty('disabled', true);

      fireEvent.click(key('Bb'));
      expect(key('Eb')).toHaveProperty('disabled', false);
    });

    it('hands the start to the next key when the first is dropped', () => {
      render(<App />);
      fireEvent.click(screen.getByText('Exercise'));

      fireEvent.click(key('Bb'));
      fireEvent.click(key('Eb'));
      expect(exerciseValues()).toContain('Bb major');
    });

    it('stops at four keys, and lets them be swapped', () => {
      // The cap is real: the scrolling header is sized for the widest key in
      // the set and holds that width for the whole exercise.
      render(<App />);
      fireEvent.click(screen.getByText('Exercise'));

      for (const name of ['Bb', 'F', 'Ab']) fireEvent.click(key(name));
      expect(key('C')).toHaveProperty('disabled', true);
      // What is already chosen can still be undone, which is how you change
      // your mind at the cap rather than being stuck.
      expect(key('Ab')).toHaveProperty('disabled', false);

      fireEvent.click(key('Ab'));
      expect(key('C')).toHaveProperty('disabled', false);
    });
  });

  it('lets the player back out of an exercise', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    fireEvent.click(screen.getByRole('button', { name: /back to settings/i }));
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
  });

  it('generates an exercise for every instrument and clef it offers', () => {
    render(<App />);
    const instrument = screen.getByLabelText<HTMLSelectElement>('Instrument');
    const ids = [...instrument.options].map((option) => option.value);
    expect(ids.length).toBeGreaterThan(4);

    for (const id of ids) {
      fireEvent.change(instrument, { target: { value: id } });

      const clefGroup = screen.getByText('Clef').parentElement!;
      const clefButtons = within(clefGroup).getAllByRole('button');

      for (let i = 0; i < clefButtons.length; i++) {
        // Re-query, since selecting a clef re-renders the group.
        const buttons = within(screen.getByText('Clef').parentElement!).getAllByRole('button');
        fireEvent.click(buttons[i]);

        // Starting is what actually runs the generator; a throw would surface here.
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        expect(
          screen.getByRole('button', { name: /tap to start/i }),
          `${id} failed to generate`,
        ).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /back to settings/i }));
      }
    }
  });
});

describe('a copy that withholds things', () => {
  /*
   * The fault this covers, which shipped for a long time behind a build flag
   * nobody sets: the settings screen offered everything, accepted the choice,
   * showed it as selected — and then `constrainToEntitlements` substituted at
   * exercise-build time with nothing on screen admitting it. Asking for Expert
   * in D major produced Easy in C. Silently ignoring a choice is worse than
   * refusing it, because a player concludes the app is broken rather than
   * limited.
   *
   * `?tier=free` forces the free tier in any build; see `licence.ts`.
   */
  const asFreeTier = () => {
    window.history.replaceState({}, '', '/?tier=free');
  };

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('says once what it is limited to, and says nothing when it is not', () => {
    render(<App />);
    expect(screen.queryByText(/this copy is limited to/i)).toBeNull();
    cleanup();

    asFreeTier();
    render(<App />);
    // Built from FREE_TIER rather than written out, so the wording cannot drift
    // away from what is actually enforced.
    expect(screen.getByText(/this copy is limited to/i).textContent).toContain('C major');
  });

  it('will not let a withheld setting be chosen', () => {
    asFreeTier();
    render(<App />);
    fireEvent.click(screen.getByText('Exercise'));

    // A key, a material and a difficulty the free tier does not include.
    expect(screen.getByRole('button', { name: 'D major, 2 sharps' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: 'Hard' })).toHaveProperty('disabled', true);
    // And one of each that it does. Material is no longer among the withheld:
    // every kind the generator can make is free, and what the free tier is
    // short of is the horizon past the end — see `Entitlements.playOn`.
    expect(screen.getByRole('button', { name: /Scales/ })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: /Arpeggios/ })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Easy' })).toHaveProperty('disabled', false);
  });

  it('shows what will be played, not what was once asked for', () => {
    /*
     * The half of this that disabling alone does not fix. A fresh install
     * defaults to E flat, which no free player ever chose — so the screen sat
     * there saying "Eb major" while the generator built the exercise in C.
     * Disabling the chips stops a *new* locked choice; it does nothing about
     * one already held.
     */
    asFreeTier();
    render(<App />);
    const summary = screen.getByText('Exercise').closest('summary');
    expect(summary?.textContent).toContain('C major');
    expect(summary?.textContent).not.toContain('Eb major');
  });

  it('keeps the choice underneath, so unlocking gives it back', () => {
    // Stored settings outlive a licence. The screen showing C must not be the
    // thing that overwrites a player's E flat.
    asFreeTier();
    render(<App />);
    expect(screen.getByText('Exercise').closest('summary')?.textContent).toContain('C major');
    cleanup();

    window.history.replaceState({}, '', '/');
    render(<App />);
    expect(screen.getByText('Exercise').closest('summary')?.textContent).toContain('Eb major');
  });
});
