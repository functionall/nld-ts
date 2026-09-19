/**
 * A *position-annotated multiset* of tokens: the input representation used by `Nld` parsers.
 *
 * Instead of a sequence, the input is indexed both ways: token to the positions where it
 * appears, and position to token. Matching a token removes exactly one occurrence, so parsers can
 * find their tokens anywhere in the input, ignore everything they were not asked for, and still
 * measure how far each match is from the previous one (see {@link TokenPositions.gapCost}).
 *
 * Values are immutable: {@link TokenPositions.remove} returns a new multiset and leaves the
 * receiver untouched, which is what lets every branch of the search share its input. The index
 * built by {@link TokenPositions.fromList} is shared between all multisets derived from it; only
 * a small "removed" mask is copied.
 *
 * Mirrors upstream `Nld.internal.TokenPositions`.
 */
export class TokenPositions {
  private constructor(
    private readonly tokens: readonly string[],
    private readonly index: ReadonlyMap<string, readonly number[]>,
    private readonly removed: Uint8Array,
    // Smallest and largest remaining position; `lo > hi` when nothing remains.
    private readonly lo: number,
    private readonly hi: number,
  ) {}

  /** Builds the multiset from a token list; positions are the list indices. */
  static fromList(tokens: readonly string[]): TokenPositions {
    const index = new Map<string, number[]>();

    tokens.forEach((token, i) => {
      const positions = index.get(token);
      if (positions) positions.push(i);
      else index.set(token, [i]);
    });

    return new TokenPositions([...tokens], index, new Uint8Array(tokens.length), 0, tokens.length - 1);
  }

  /** Remaining positions of `token`, ascending. Empty if the token is absent. */
  positions(token: string): number[] {
    const all = this.index.get(token);
    return all ? all.filter((pos) => this.removed[pos] === 0) : [];
  }

  /** Removes the occurrence of `token` at `pos`. A no-op if there is no such occurrence. */
  remove(token: string, pos: number): TokenPositions {
    if (this.tokenAt(pos) !== token) return this;

    const removed = this.removed.slice();
    removed[pos] = 1;

    let { lo, hi } = this;
    while (lo <= hi && removed[lo] === 1) lo++;
    while (hi >= lo && removed[hi] === 1) hi--;

    return new TokenPositions(this.tokens, this.index, removed, lo, hi);
  }

  /** Smallest and largest remaining position, or `null` when nothing remains. */
  bounds(): [min: number, max: number] | null {
    return this.lo <= this.hi ? [this.lo, this.hi] : null;
  }

  /** The remaining token at `pos`, if any (negative positions never have one). */
  tokenAt(pos: number): string | undefined {
    return this.removed[pos] === 0 ? this.tokens[pos] : undefined;
  }

  /**
   * Cost of matching at `current` after a match at `previous`.
   *
   * Forward gaps cost their distance; backward jumps cost 1.5 times the distance plus one.
   *
   * @example
   * TokenPositions.gapCost(0, 3) // => 3
   * TokenPositions.gapCost(3, 1) // => 4.5
   */
  static gapCost(previous: number, current: number): number {
    return current >= previous ? current - previous : 1.5 * (previous - current + 1);
  }

  /**
   * Weighted offsets in `lo..hi` around the previous position, radiating outwards: offset 0
   * first, then +1, -1, +2, -2, ... each weighted by its absolute value. Offsets outside the
   * range are skipped, except that offset 0 is emitted whenever `hi >= 0` (as upstream does).
   * Empty if `lo > hi`.
   *
   * @example
   * TokenPositions.weightedRange(-1, 2) // => [[0, 0], [1, 1], [1, -1], [2, 2]]
   * TokenPositions.weightedRange(-2, -1) // => [[1, -1], [2, -2]]
   * TokenPositions.weightedRange(1, 0) // => []
   */
  static weightedRange(lo: number, hi: number): [weight: number, offset: number][] {
    if (lo > hi) return [];

    const out: [number, number][] = [];

    for (let n = 0; n <= hi || -n >= lo; n++) {
      if (n === 0) {
        if (0 <= hi) out.push([0, 0]);
      } else {
        if (n <= hi) out.push([n, n]);
        if (-n >= lo) out.push([n, -n]);
      }
    }

    return out;
  }
}
