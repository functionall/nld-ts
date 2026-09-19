// The shape of test/fixtures/conformance.json, and how a recorded case is replayed against this
// library. Shared by test/conformance.test.ts and the in-browser check (test/browser/check.ts).

import * as N from "../../src/index.js";
import { core, pipe, type Dsl } from "./dsl.js";

export interface Case {
  layer: "core" | "pipe";
  spec: unknown;
  input: { tokens: string[] } | { text: string };
  opts: { downcase?: boolean };
  run: [weight: number, result: unknown][];
  autocomplete: [weight: number, tokens: string[]][];
  grammar: unknown;
  wanted: string[];
}

export interface Fixtures {
  /** How many `run` and `autocomplete` entries were recorded per case. */
  limit: number;
  cases: Case[];
  tokenizer: { text: string; tokens: string[]; downcased: string[] }[];
}

export type Recorded = Pick<Case, "run" | "autocomplete" | "grammar" | "wanted">;

export function inputOf(c: Case): string | string[] {
  return "tokens" in c.input ? c.input.tokens : c.input.text;
}

/** What the recording said this library should produce for `c`. */
export function expected({ run, autocomplete, grammar, wanted }: Case): Recorded {
  return { run, autocomplete, grammar, wanted };
}

/** What this library actually produces for `c`. */
export function actual(c: Case, limit: number): Recorded {
  const spec = c.layer === "core" ? core(c.spec as Dsl) : pipe(c.spec as Dsl[]);
  const input = inputOf(c);

  return {
    run: take(N.run(spec, input, c.opts), limit),
    autocomplete: take(N.autocomplete(spec, input, c.opts), limit),
    grammar: N.grammar(spec),
    wanted: [...N.wanted(spec)].sort(),
  };
}

function take<T>(items: Iterable<T>, count: number): T[] {
  const taken: T[] = [];

  for (const item of items) {
    taken.push(item);
    if (taken.length >= count) break;
  }

  return taken;
}
