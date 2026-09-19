import { Grammar } from "./grammar.js";
import type { TokenPositions } from "./token-positions.js";

/**
 * A weighted fork of alternatives, each a `[weight, thunk]` pair. An empty fork is a dead
 * branch.
 */
export interface Fork<T> {
  readonly fork: readonly Alternative<T>[];
}

/** One alternative of a {@link Fork}: its extra cost and the computation to resume. */
export type Alternative<T> = readonly [weight: number, thunk: () => Outcome<T>];

/** What a continuation returns: the next parser state, or a weighted fork of alternatives. */
export type Outcome<T> = Nld<T> | Fork<T>;

/** A `more` continuation, called with the remaining tokens and the last matched position. */
export type Continuation<T> = (remaining: TokenPositions, lastPos: number) => Outcome<T>;

/**
 * The state of a parser:
 *
 *   - `done`: finished, with the tokens left over and the position of the furthest token
 *     consumed;
 *   - `more`: needs input; `k(remaining, lastPos)` returns either the next `Nld` or a weighted
 *     {@link Fork} of alternatives.
 */
export type Step<T> =
  | {
      readonly kind: "done";
      readonly value: T;
      readonly remaining: TokenPositions;
      readonly lastPos: number;
    }
  | {
      readonly kind: "more";
      readonly grammar: Grammar;
      readonly wanted: ReadonlySet<string>;
      readonly k: Continuation<T>;
    };

/**
 * A parser yielding values of type `T`: a resumable step machine. See the `core` module for the
 * combinators that build and run one, and the package entry point for the chainable `Spec`
 * builders implemented on top of it.
 */
export class Nld<out T> {
  constructor(readonly step: Step<T>) {}

  /** Renders the parser's grammar, for example `#Nld<seq [literal "set", token nat]>`. */
  toString(): string {
    const { step } = this;
    return `#Nld<${Grammar.format(step.kind === "done" ? Grammar.seq([]) : step.grammar)}>`;
  }
}

/** The result type of a parser: `ValueOf<Nld<string>>` is `string`. */
export type ValueOf<N> = N extends Nld<infer T> ? T : never;
