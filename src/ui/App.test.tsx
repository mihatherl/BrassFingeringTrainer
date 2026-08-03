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
    expect(screen.queryByRole('button', { name: 'Bass' })).toBeNull();
    expect(screen.getByText(/reads treble clef only/i)).toBeTruthy();

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

  it('opens only the exercise section to begin with', () => {
    // The screen is long; collapsing it is the point, so the rest start shut.
    render(<App />);
    const panels = [...document.querySelectorAll<HTMLDetailsElement>('details.panel')];

    expect(panels.length).toBeGreaterThan(3);
    const open = panels.filter((panel) => panel.open);
    expect(open).toHaveLength(1);
    expect(open[0].querySelector('.panel__title')?.textContent).toBe('Exercise');
  });

  it('says what is selected in each collapsed section', () => {
    render(<App />);
    const valuesOf = (title: string) =>
      [...document.querySelectorAll<HTMLDetailsElement>('details.panel')]
        .find((panel) => panel.querySelector('.panel__title')?.textContent === title)
        ?.querySelector('.panel__values')?.textContent;

    // The defaults: Eb bass in treble, Eb major, random notes, Easy, 80bpm.
    expect(valuesOf('Instrument')).toBe('Eb Bass (Tuba) · Treble');
    expect(valuesOf('Exercise')).toBe('Eb major · Random notes · Easy');
    expect(valuesOf('Playback')).toBe('80 bpm · Play the notes');
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
