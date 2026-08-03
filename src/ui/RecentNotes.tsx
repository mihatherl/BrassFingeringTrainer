/**
 * The last few notes played, newest first.
 *
 * Scrolling notation cannot show a verdict for long enough to read: a note is
 * judged at its onset plus the timing tolerance, and by then it has already
 * passed the strike line and been clipped away. The strike line flashes the
 * verdict for the corner of the eye; this is where the detail goes.
 *
 * Deliberately not something to watch note by note — reading music means
 * looking two bars ahead, so anything at the edge of the screen is read in the
 * gaps: a bar's rest, a phrase ending, or after the exercise stops. That is why
 * the correct fingering appears only on the notes that went wrong. A column of
 * digits for notes that were right would be a wall to search rather than an
 * answer to find.
 */

import type { Verdict } from '../engine/judge';

export interface RecentNote {
  /** Note index in the exercise: stable, and unique within a run. */
  id: number;
  /** Written pitch, as the player read it. */
  name: string;
  verdict: Verdict;
  /** What they held, or null when they held nothing at all. */
  held: string | null;
  /** What they should have held. */
  expected: string;
}

interface RecentNotesProps {
  notes: RecentNote[];
}

export function RecentNotes({ notes }: RecentNotesProps) {
  return (
    <ol className="recent" aria-label="Recent notes">
      {notes.map((note) => (
        <li key={note.id} className={`recent__item recent__item--${note.verdict}`}>
          <span className="recent__pitch">{note.name}</span>
          <span className="recent__played">{note.held ?? '—'}</span>
          {note.verdict !== 'correct' && <span className="recent__wanted">{note.expected}</span>}
        </li>
      ))}
    </ol>
  );
}
