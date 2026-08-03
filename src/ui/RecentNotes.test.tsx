// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { RecentNotes, type RecentNote } from './RecentNotes';

afterEach(cleanup);

const CORRECT: RecentNote = { id: 1, name: 'G4', verdict: 'correct', held: '1-2', expected: '1-2' };
const WRONG: RecentNote = { id: 2, name: 'F♯4', verdict: 'wrong', held: '1', expected: '2' };
const MISSED: RecentNote = { id: 3, name: 'B♭3', verdict: 'missed', held: null, expected: 'open' };

function rows() {
  return within(screen.getByRole('list', { name: 'Recent notes' })).getAllByRole('listitem');
}

describe('the recent notes list', () => {
  it('shows only what was played when the note was right', () => {
    render(<RecentNotes notes={[CORRECT]} />);
    const [row] = rows();
    expect(row.textContent).toContain('G4');
    expect(row.textContent).toContain('1-2');
    // The fingering it wanted is the same one; repeating it would be noise.
    expect(row.querySelector('.recent__wanted')).toBeNull();
  });

  it('shows the fingering that was wanted when the note was wrong', () => {
    render(<RecentNotes notes={[WRONG]} />);
    const [row] = rows();
    expect(row.querySelector('.recent__played')?.textContent).toBe('1');
    expect(row.querySelector('.recent__wanted')?.textContent).toBe('2');
  });

  it('does not credit a missed note with an open fingering', () => {
    // Holding nothing is an absent answer, not a choice of "open" — and where
    // open happens to be the right answer, saying so would be a lie.
    render(<RecentNotes notes={[MISSED]} />);
    const [row] = rows();
    expect(row.querySelector('.recent__played')?.textContent).toBe('—');
    expect(row.querySelector('.recent__wanted')?.textContent).toBe('open');
  });

  it('keeps the order it is given, newest first', () => {
    render(<RecentNotes notes={[MISSED, WRONG, CORRECT]} />);
    expect(rows().map((row) => row.querySelector('.recent__pitch')?.textContent)).toEqual([
      'B♭3',
      'F♯4',
      'G4',
    ]);
  });

  it('is present but empty before the first note', () => {
    // The list keeps its space from the start, so the stave does not jump when
    // the first verdict lands.
    render(<RecentNotes notes={[]} />);
    const list = screen.getByRole('list', { name: 'Recent notes' });
    expect(within(list).queryAllByRole('listitem')).toHaveLength(0);
  });
});
