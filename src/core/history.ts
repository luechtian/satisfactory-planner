/**
 * Undo and redo over the plan.
 *
 * Snapshots rather than inverse operations: the plan is plain data updated by spreading,
 * so an untouched site is the same object in every snapshot and keeping fifty of them
 * costs little. Writing an inverse for each of two dozen actions would be a lot of code
 * whose bugs only show up as silent corruption.
 *
 * Kept out of the store because the rule worth getting right — what counts as one step —
 * is not obvious, and none of it is reachable by a test once it is tangled up in zustand
 * and a React tree.
 */

import type { Plan } from "./types";

/**
 * How long a gesture can pause and still be the same step.
 *
 * Dragging a node fires an update per pointer move, and typing "120" into a rate fires
 * one per digit; without this, undo would walk back through a drag pixel by pixel and
 * nobody would use it twice.
 */
const COALESCE_MS = 600;

/** Steps kept in each direction. Enough to get out of trouble, not a session log. */
const LIMIT = 60;

export interface Step {
  plan: Plan;
  /** the site open when this was taken, so undo can put you back where the change was */
  siteId: string;
}

export interface History {
  past: Step[];
  future: Step[];
  /** what the last recorded edit was called, for coalescing */
  tag?: string;
  /** when it happened */
  at: number;
}

export const emptyHistory = (): History => ({ past: [], future: [], at: 0 });

export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;

/**
 * Note that the plan is about to change, given the state it is changing *from*.
 *
 * Edits carrying the same tag in quick succession are one gesture, so only the state
 * before the first of them is kept. An untagged edit always starts a step of its own:
 * solving, deleting a site and importing a file are each a single thing to undo however
 * fast they follow one another.
 */
export function record(h: History, previous: Step, tag: string | undefined, now: number): History {
  const sameGesture = tag !== undefined && tag === h.tag && now - h.at < COALESCE_MS;
  return {
    past: sameGesture ? h.past : [...h.past, previous].slice(-LIMIT),
    // Anything undone is only reachable until the moment you edit instead of redoing.
    future: [],
    tag,
    at: now,
  };
}

/** Step back, given where the plan is now. Null when there is nothing to go back to. */
export function undo(h: History, current: Step): { history: History; step: Step } | null {
  const step = h.past[h.past.length - 1];
  if (!step) return null;
  return {
    step,
    history: {
      past: h.past.slice(0, -1),
      future: [current, ...h.future].slice(0, LIMIT),
      // Cleared so the next edit opens a step of its own rather than coalescing into
      // the state just restored, which would swallow the undo itself.
      tag: undefined,
      at: 0,
    },
  };
}

/** Step forward again. Null once the future has been spent or thrown away by an edit. */
export function redo(h: History, current: Step): { history: History; step: Step } | null {
  const [step, ...rest] = h.future;
  if (!step) return null;
  return {
    step,
    history: {
      past: [...h.past, current].slice(-LIMIT),
      future: rest,
      tag: undefined,
      at: 0,
    },
  };
}
