// Best-first search over parser *outcomes* (upstream: the `Peach` handler, `Peach.toStream`, and
// `Nld.autocomplete`'s dedicated handler).
//
//     outcome :: Nld | { fork: [[weight, () => outcome]] }      // { fork: [] } = dead branch
//
// Weighted alternatives go on a priority queue keyed by [totalWeight, insertionSeq], so lower
// totals come first and equal totals are explored first-in-first-out, exactly as upstream.

import { Nld, type Outcome } from "./parser.js";
import type { TokenPositions } from "./token-positions.js";

// -- priority queue -----------------------------------------------------------------------------

interface Entry<T> {
  readonly weight: number;
  readonly seq: number;
  readonly item: T;
}

/** A binary min-heap on `[weight, seq]`; `seq` makes keys unique, hence the order total. */
class PriorityQueue<T> {
  private readonly heap: Entry<T>[] = [];
  private seq = 0;

  push(weight: number, item: T): void {
    const { heap } = this;
    const entry: Entry<T> = { weight, seq: this.seq++, item };
    let i = heap.length;

    while (i > 0) {
      const parent = (i - 1) >> 1;
      const above = heap[parent]!;
      if (!before(entry, above)) break;
      heap[i] = above;
      i = parent;
    }

    heap[i] = entry;
  }

  pop(): Entry<T> | undefined {
    const { heap } = this;
    const top = heap[0];
    const last = heap.pop();
    if (top === undefined || last === undefined || heap.length === 0) return top;

    let i = 0;

    for (;;) {
      const left = 2 * i + 1;
      if (left >= heap.length) break;
      const right = left + 1;
      const child = right < heap.length && before(heap[right]!, heap[left]!) ? right : left;
      if (!before(heap[child]!, last)) break;
      heap[i] = heap[child]!;
      i = child;
    }

    heap[i] = last;
    return top;
  }
}

function before(a: Entry<unknown>, b: Entry<unknown>): boolean {
  return a.weight < b.weight || (a.weight === b.weight && a.seq < b.seq);
}

// -- running parsers ----------------------------------------------------------------------------

/** A finished parse: its value, the tokens left over and the position of the last match. */
export type Parsed<T> = readonly [value: T, remaining: TokenPositions, lastPos: number];

type Resolved<T> =
  | { readonly value: Parsed<T> }
  | { readonly fork: readonly (readonly [weight: number, thunk: () => Resolved<T>])[] };

/**
 * Drives `nld` from an explicit state, lazily yielding `[weight, [value, remaining, lastPos]]`
 * best-first. Mirrors upstream `run`'s `go` and `repeat`'s `step`: continuations are called with
 * the given state and followed inline until they finish or fork.
 */
export function* runFrom<T>(
  nld: Nld<T>,
  positions: TokenPositions,
  lastPos: number,
): Generator<[weight: number, parsed: Parsed<T>], void, undefined> {
  const pq = new PriorityQueue<() => Resolved<T>>();
  pq.push(0, () => resolve(nld, positions, lastPos));

  for (let entry = pq.pop(); entry !== undefined; entry = pq.pop()) {
    const resolved = entry.item();

    if ("value" in resolved) yield [entry.weight, resolved.value];
    else for (const [weight, thunk] of resolved.fork) pq.push(entry.weight + weight, thunk);
  }
}

/** Runs `nld` on the whole input, yielding `[weight, value]` best-first. */
export function* run<T>(
  nld: Nld<T>,
  positions: TokenPositions,
): Generator<[weight: number, value: T], void, undefined> {
  for (const [weight, [value]] of runFrom(nld, positions, 0)) yield [weight, value];
}

function resolve<T>(outcome: Outcome<T>, positions: TokenPositions, lastPos: number): Resolved<T> {
  while (outcome instanceof Nld) {
    const { step } = outcome;
    if (step.kind === "done") return { value: [step.value, step.remaining, step.lastPos] };
    outcome = step.k(positions, lastPos);
  }

  return {
    fork: outcome.fork.map(([weight, thunk]) => [weight, () => resolve(thunk(), positions, lastPos)]),
  };
}

// -- autocomplete -------------------------------------------------------------------------------

/**
 * Runs `nld` and, wherever a branch dies, yields `[weight, wantedTokens]`: the (sorted) tokens
 * the most recently entered parser was looking for. Mirrors the upstream handler exactly,
 * including that `more` continuations are queued rather than followed inline.
 */
export function* autocomplete(
  nld: Nld<unknown>,
  positions: TokenPositions,
): Generator<[weight: number, tokens: string[]], void, undefined> {
  const pq = new PriorityQueue<readonly [thunk: () => Outcome<unknown>, wanted: readonly string[]]>();
  pq.push(0, [() => nld, []]);

  for (let entry = pq.pop(); entry !== undefined; entry = pq.pop()) {
    const { weight, item } = entry;
    const [thunk, wanted] = item;
    const outcome = thunk();

    if (outcome instanceof Nld) {
      const { step } = outcome;

      if (step.kind === "more") {
        pq.push(weight, [() => step.k(positions, 0), [...step.wanted].sort(compareCodePoints)]);
      }
    } else if (outcome.fork.length === 0) {
      yield [weight, [...wanted]];
    } else {
      for (const [extra, alternative] of outcome.fork) pq.push(weight + extra, [alternative, wanted]);
    }
  }
}

// Orders strings by code point. JavaScript's default sort compares UTF-16 code units, which
// differs once astral characters are involved.
function compareCodePoints(a: string, b: string): number {
  const length = Math.min(a.length, b.length);

  for (let i = 0; i < length; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);

    if (x !== y) {
      const xSurrogate = x >= 0xd800 && x <= 0xdfff;
      const ySurrogate = y >= 0xd800 && y <= 0xdfff;
      if (xSurrogate !== ySurrogate) return xSurrogate ? 1 : -1;
      return x - y;
    }
  }

  return a.length - b.length;
}
