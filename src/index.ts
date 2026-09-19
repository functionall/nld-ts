/**
 * Natural Language Disambiguators: parsers for turning loosely phrased natural language into a
 * small set of structured commands, deterministically and in microseconds, with no backend.
 *
 * An `Nld` spec looks for the tokens you name and ignores everything else, accepts them in any
 * order (the specified order is preferred), ranks every possible parse best-first, and can tell
 * you which tokens would let an incomplete input parse (autocomplete). This is a TypeScript port
 * of [`@pchiusano/nlds`](https://share.unison-lang.org/@pchiusano/nlds) (Unison); see
 * {@link Core} for the one-to-one port of the upstream combinators.
 *
 * ## Building specs
 *
 * Specs are built by chaining: every builder exists as a function that starts a spec and as a
 * method that continues one, so `word("a")` starts a spec and `.word("b")` continues it. A spec
 * yields a **list** of results; each leaf contributes one element and `ignore`, `tag`,
 * `unwrapAndTag`, `reduce` and friends shape that list.
 *
 * ```ts
 * import { best, choice, ignore, nat, parse, suggest, word, words } from "nld-ts";
 *
 * const cancel = ignore(words(["cancel", "stop", "halt"]))
 *   .ignore(word("order"))
 *   .optional(nat())
 *   .tag("cancel_order");
 *
 * const status = ignore(word("order"))
 *   .ignore(word("status"))
 *   .optional(nat())
 *   .tag("order_status");
 *
 * const intents = choice([cancel, status]);
 *
 * parse(intents, "Please cancel my order 42");
 * // => [[{ tag: "cancel_order", value: [42] }], [{ tag: "cancel_order", value: [] }]]
 * best(intents, "order status"); // => [{ tag: "order_status", value: [] }]
 * suggest(intents, "canc");
 * // => [["cancel", "halt", "order", "stop"], ["cancel", "halt", "order", "stop"]]
 * ```
 *
 * The last call shows a quirk kept for parity with upstream: a `choice` reports the union of
 * its alternatives' wanted tokens, once per alternative that got stuck.
 *
 * ## Running specs
 *
 * `parse`, `best`, `run`, `suggest` and `autocomplete` accept either a string or a token list.
 * Strings are split with `tokenize` and downcased (pass `downcase: false` to keep case, or
 * `tokenizer` to split differently); token lists are used exactly as given. Results are ordered
 * by total weight: the sum of the gap between each matched token and the previous match
 * (backward jumps cost 1.5x plus one), synonym base weights, and one per omitted
 * `repeat`/`optional` item.
 *
 * @module
 */

import * as Core from "./core.js";
import type { TokenParser, WeightedToken } from "./core.js";
import type { Grammar, TokenType, TokenTypeName } from "./grammar.js";
import { Nld } from "./parser.js";
import { downcase, tokenize } from "./tokenizer.js";

export * as Core from "./core.js";
export { Grammar, tokenType } from "./grammar.js";
export type { GrammarResult, TokenType, TokenTypeName, WeightedText } from "./grammar.js";
export { Nld } from "./parser.js";
export type { Alternative, Continuation, Fork, Outcome, Step, ValueOf } from "./parser.js";
export { TokenPositions } from "./token-positions.js";
export { downcase, tokenize } from "./tokenizer.js";
export type { Indexed, TokenParser, WeightedToken } from "./core.js";

/** A result labelled by `tag` or `unwrapAndTag`. */
export interface Tagged<T, V> {
  readonly tag: T;
  readonly value: V;
}

/** The result list of a spec: `ResultsOf<Spec<[string]>>` is `[string]`. */
export type ResultsOf<N> = N extends Nld<infer R extends unknown[]> ? R : never;

/** Input for the runners: raw text or a token list. */
export type Input = string | readonly string[];

/** Options for the runners that take text. */
export interface RunOptions {
  /** Downcase the tokens of a string input. Defaults to `true`. */
  readonly downcase?: boolean | undefined;
  /** Splits a string input into tokens. Defaults to {@link tokenize}. */
  readonly tokenizer?: ((text: string) => string[]) | undefined;
}

/** Options for {@link parse} and {@link suggest}. */
export interface LimitOptions extends RunOptions {
  /** Return at most this many results. */
  readonly limit?: number | undefined;
}

type Indexed<T> = Core.Indexed<T>;

/**
 * A spec: an {@link Nld} that yields a list of results, with every builder available as a
 * chainable method. Specs are immutable; each method returns a new spec.
 */
export class Spec<out R extends unknown[]> extends Nld<R> {
  /**
   * Makes any parser that yields a list chainable; a `Spec` is returned as is. Use it to continue
   * a {@link Core} parser with the builders.
   *
   * @example
   * const pair = Core.map2(Core.nat(), Core.nat(), (a, b) => [a, b]);
   * parse(Spec.from(pair).word("x"), "1 2 x", { limit: 1 }) // => [[1, 2, "x"]]
   */
  static from<R extends unknown[]>(nld: Nld<R>): Spec<R> {
    return nld instanceof Spec ? nld : new Spec(nld.step);
  }

  // -- building blocks --------------------------------------------------------------------------

  /** Sequences another spec after this one, concatenating their results. */
  concat<S extends unknown[]>(spec: Nld<S>): Spec<[...R, ...S]> {
    return Spec.from(Core.map2(this, spec, (a, b): [...R, ...S] => [...a, ...b]));
  }

  /** Then {@link word}. */
  word(word_: string): Spec<[...R, string]> {
    return this.concat(word(word_));
  }

  /** Then {@link words}. */
  words(words_: readonly string[]): Spec<[...R, string]> {
    return this.concat(words(words_));
  }

  /** Then {@link minimalToken}. */
  minimalToken(weightedTokens: readonly WeightedToken[]): Spec<[...R, string]> {
    return this.concat(minimalToken(weightedTokens));
  }

  /** Then {@link phrase}. */
  phrase(words_: readonly string[]): Spec<[...R, string]> {
    return this.concat(phrase(words_));
  }

  /** Then {@link token}. */
  token(): Spec<[...R, string]> {
    return this.concat(token());
  }

  /** Then {@link tokenMatching}. */
  tokenMatching(pred: (token: string) => boolean): Spec<[...R, string]> {
    return this.concat(tokenMatching(pred));
  }

  /** Then {@link tokenOfType}. */
  tokenOfType<V>(type: TokenType | TokenTypeName, parse_: TokenParser<V>): Spec<[...R, V]> {
    return this.concat(tokenOfType(type, parse_));
  }

  /** Then {@link nat}. */
  nat(): Spec<[...R, number]> {
    return this.concat(nat());
  }

  /** Then {@link int}. */
  int(): Spec<[...R, number]> {
    return this.concat(int());
  }

  /** Then {@link float}. */
  float(): Spec<[...R, number]> {
    return this.concat(float());
  }

  /** Then {@link boolean}. */
  boolean(): Spec<[...R, boolean]> {
    return this.concat(boolean());
  }

  /** Then {@link indexedWord}. */
  indexedWord(word_: string): Spec<[...R, Indexed<string>]> {
    return this.concat(indexedWord(word_));
  }

  /** Then {@link indexedWords}. */
  indexedWords(words_: readonly string[]): Spec<[...R, Indexed<string>]> {
    return this.concat(indexedWords(words_));
  }

  /** Then {@link indexedMinimalToken}. */
  indexedMinimalToken(weightedTokens: readonly WeightedToken[]): Spec<[...R, Indexed<string>]> {
    return this.concat(indexedMinimalToken(weightedTokens));
  }

  /** Then {@link indexedToken}. */
  indexedToken(): Spec<[...R, Indexed<string>]> {
    return this.concat(indexedToken());
  }

  /** Then {@link indexedTokenMatching}. */
  indexedTokenMatching(pred: (token: string) => boolean): Spec<[...R, Indexed<string>]> {
    return this.concat(indexedTokenMatching(pred));
  }

  /** Then {@link indexedTokenOfType}. */
  indexedTokenOfType<V>(
    type: TokenType | TokenTypeName,
    parse_: TokenParser<V>,
  ): Spec<[...R, Indexed<V>]> {
    return this.concat(indexedTokenOfType(type, parse_));
  }

  /** Then {@link indexedNat}. */
  indexedNat(): Spec<[...R, Indexed<number>]> {
    return this.concat(indexedNat());
  }

  /** Then {@link indexedInt}. */
  indexedInt(): Spec<[...R, Indexed<number>]> {
    return this.concat(indexedInt());
  }

  /** Then {@link indexedFloat}. */
  indexedFloat(): Spec<[...R, Indexed<number>]> {
    return this.concat(indexedFloat());
  }

  /** Then {@link indexedBoolean}. */
  indexedBoolean(): Spec<[...R, Indexed<boolean>]> {
    return this.concat(indexedBoolean());
  }

  // -- combinators ------------------------------------------------------------------------------

  /** Then {@link choice} between `alternatives`. */
  choice<const S extends readonly Nld<unknown[]>[]>(
    alternatives: S,
  ): Spec<[...R, ...ResultsOf<S[number]>]> {
    return this.concat(choice(alternatives));
  }

  /** Then {@link repeat} of `spec`. */
  repeat<S extends unknown[]>(spec: Nld<S>): Spec<[...R, ...S[number][]]> {
    return this.concat(repeat(spec));
  }

  /** Then {@link optional} `spec`. */
  optional<S extends unknown[]>(spec: Nld<S>): Spec<[...R, ...([] | S)]> {
    return this.concat(optional(spec)) as Spec<[...R, ...([] | S)]>;
  }

  /** Then match `spec`, dropping its results. See {@link ignore}. */
  ignore(spec: Nld<unknown>): Spec<R> {
    return this.concat(ignore(spec)) as Spec<unknown[]> as Spec<R>;
  }

  /** Then {@link wrap} of `spec`. */
  wrap<S>(spec: Nld<S>): Spec<[...R, S]> {
    return this.concat(wrap(spec));
  }

  /**
   * With one argument, tags every result so far; with two, continues with `spec` tagged. See
   * {@link tag}.
   *
   * @example
   * parse(word("a").word("b").tag("ab"), "a b") // => [[{ tag: "ab", value: ["a", "b"] }]]
   * parse(word("a").tag(word("b"), "b").word("c"), "a b c")
   * // => [["a", { tag: "b", value: ["b"] }, "c"]]
   */
  tag<const T>(name: T): Spec<[Tagged<T, R>]>;
  tag<S, const T>(spec: Nld<S>, name: T): Spec<[...R, Tagged<T, S>]>;
  tag(...args: [unknown] | [Nld<unknown>, unknown]): Spec<unknown[]> {
    return args.length === 1 ? tag(this, args[0]) : this.concat(tag(args[0], args[1]));
  }

  /**
   * With one argument, unwraps and tags the single result so far; with two, continues with
   * `spec` unwrapped and tagged. See {@link unwrapAndTag}.
   */
  unwrapAndTag<const T>(name: T): Spec<[Tagged<T, R[number]>]>;
  unwrapAndTag<S extends unknown[], const T>(
    spec: Nld<S>,
    name: T,
  ): Spec<[...R, Tagged<T, S[number]>]>;
  unwrapAndTag(...args: [unknown] | [Nld<unknown[]>, unknown]): Spec<unknown[]> {
    return args.length === 1
      ? unwrapAndTag(this, args[0])
      : this.concat(unwrapAndTag(args[0], args[1]));
  }

  /**
   * With one argument, reduces the results so far to a single value; with two, continues with
   * `spec` reduced. See {@link reduce}.
   */
  reduce<V>(fun: (results: R) => V): Spec<[V]>;
  reduce<S, V>(spec: Nld<S>, fun: (results: S) => V): Spec<[...R, V]>;
  reduce(
    ...args: [(results: R) => unknown] | [Nld<unknown>, (results: unknown) => unknown]
  ): Spec<unknown[]> {
    return args.length === 1 ? reduce(this, args[0]) : this.concat(reduce(args[0], args[1]));
  }

  /**
   * With one argument, applies `fun` to each result so far; with two, continues with `spec`
   * mapped. See {@link map}.
   */
  map<V>(fun: (item: R[number]) => V): Spec<MapResults<R, V>>;
  map<S extends unknown[], V>(
    spec: Nld<S>,
    fun: (item: S[number]) => V,
  ): Spec<[...R, ...MapResults<S, V>]>;
  map(
    ...args: [(item: unknown) => unknown] | [Nld<unknown[]>, (item: unknown) => unknown]
  ): Spec<unknown[]> {
    return args.length === 1 ? map(this, args[0]) : this.concat(map(args[0], args[1]));
  }

  /**
   * With one argument, replaces the results so far with `[value]`; with two, continues with
   * `spec` replaced. See {@link replace}.
   */
  replace<const V>(value: V): Spec<[V]>;
  replace<const V>(spec: Nld<unknown>, value: V): Spec<[...R, V]>;
  replace(...args: [unknown] | [Nld<unknown>, unknown]): Spec<unknown[]> {
    return args.length === 1 ? replace(this, args[0]) : this.concat(replace(args[0], args[1]));
  }

  // -- running ----------------------------------------------------------------------------------

  /** See {@link run}. */
  run(input: Input, opts?: RunOptions): Generator<[weight: number, results: R], void, undefined> {
    return run(this, input, opts);
  }

  /** See {@link parse}. */
  parse(input: Input, opts?: LimitOptions): R[] {
    return parse(this, input, opts);
  }

  /** See {@link best}. */
  best(input: Input, opts?: RunOptions): R | null {
    return best(this, input, opts);
  }

  /** See {@link autocomplete}. */
  autocomplete(
    input: Input,
    opts?: RunOptions,
  ): Generator<[weight: number, tokens: string[]], void, undefined> {
    return autocomplete(this, input, opts);
  }

  /** See {@link suggest}. */
  suggest(input: Input, opts?: LimitOptions): string[][] {
    return suggest(this, input, opts);
  }

  /** See {@link grammar}. */
  grammar(): Grammar {
    return Core.grammar(this);
  }

  /** See {@link wanted}. */
  wanted(): ReadonlySet<string> {
    return Core.wanted(this);
  }
}

/** The results of mapping each element of `R` to a `V`: the same length, every element a `V`. */
export type MapResults<R extends unknown[], V> = { [K in keyof R]: V };

function leaf<T>(core: Nld<T>): Spec<[T]> {
  return Spec.from(Core.map(core, (value): [T] => [value]));
}

// -- building blocks ----------------------------------------------------------------------------

/** A spec that matches nothing and yields `[]`. Rarely needed: builders start on their own. */
export function empty(): Spec<[]> {
  return Spec.from(Core.pure<[]>([]));
}

/** Sequences two specs, concatenating their results. */
export function concat<R extends unknown[], S extends unknown[]>(
  prev: Nld<R>,
  spec: Nld<S>,
): Spec<[...R, ...S]> {
  return Spec.from(prev).concat(spec);
}

/** Matches one occurrence of `word` anywhere in the input (closest first). */
export function word(word: string): Spec<[string]> {
  return leaf(Core.word(word));
}

/**
 * Matches any of the words, treating the rest as synonyms of the first, and yields the first.
 *
 * @example
 * parse(words(["buy", "purchase", "get"]), "I'd like to purchase it") // => [["buy"]]
 */
export function words(words: readonly string[]): Spec<[string]> {
  return leaf(Core.words(words));
}

/** Matches any of several `[weight, token]` alternatives; lower weight plus gap wins. */
export function minimalToken(weightedTokens: readonly WeightedToken[]): Spec<[string]> {
  return leaf(Core.minimalToken(weightedTokens));
}

/** Matches all of the words (given order preferred) and yields them joined by spaces. */
export function phrase(words: readonly string[]): Spec<[string]> {
  return leaf(Core.phrase(words));
}

/** Matches any single token, closest to the previous match first. */
export function token(): Spec<[string]> {
  return leaf(Core.token());
}

/** Matches any token satisfying `pred`. */
export function tokenMatching(pred: (token: string) => boolean): Spec<[string]> {
  return leaf(Core.tokenMatching(pred));
}

/**
 * Matches a token accepted by `parse` (which returns the value, or `undefined` to reject the
 * token); `type` documents it in the grammar.
 */
export function tokenOfType<V>(type: TokenType | TokenTypeName, parse: TokenParser<V>): Spec<[V]> {
  return leaf(Core.tokenOfType(type, parse));
}

/** Matches a natural number. */
export function nat(): Spec<[number]> {
  return leaf(Core.nat());
}

/** Matches an integer. */
export function int(): Spec<[number]> {
  return leaf(Core.int());
}

/** Matches a floating-point number. */
export function float(): Spec<[number]> {
  return leaf(Core.float());
}

/** Matches `true` or `false`, case-insensitively. */
export function boolean(): Spec<[boolean]> {
  return leaf(Core.boolean());
}

/** Like {@link word} but yields `[word, position]`. */
export function indexedWord(word: string): Spec<[Indexed<string>]> {
  return leaf(Core.indexedWord(word));
}

/** Like {@link words} but yields `[word, position]`. */
export function indexedWords(words: readonly string[]): Spec<[Indexed<string>]> {
  return leaf(Core.indexedWords(words));
}

/** Like {@link minimalToken} but yields `[token, position]`. */
export function indexedMinimalToken(
  weightedTokens: readonly WeightedToken[],
): Spec<[Indexed<string>]> {
  return leaf(Core.indexedMinimalToken(weightedTokens));
}

/** Like {@link token} but yields `[token, position]`. */
export function indexedToken(): Spec<[Indexed<string>]> {
  return leaf(Core.indexedToken());
}

/** Like {@link tokenMatching} but yields `[token, position]`. */
export function indexedTokenMatching(pred: (token: string) => boolean): Spec<[Indexed<string>]> {
  return leaf(Core.indexedTokenMatching(pred));
}

/** Like {@link tokenOfType} but yields `[value, position]`. */
export function indexedTokenOfType<V>(
  type: TokenType | TokenTypeName,
  parse: TokenParser<V>,
): Spec<[Indexed<V>]> {
  return leaf(Core.indexedTokenOfType(type, parse));
}

/** Like {@link nat} but yields `[number, position]`. */
export function indexedNat(): Spec<[Indexed<number>]> {
  return leaf(Core.indexedNat());
}

/** Like {@link int} but yields `[number, position]`. */
export function indexedInt(): Spec<[Indexed<number>]> {
  return leaf(Core.indexedInt());
}

/** Like {@link float} but yields `[number, position]`. */
export function indexedFloat(): Spec<[Indexed<number>]> {
  return leaf(Core.indexedFloat());
}

/** Like {@link boolean} but yields `[boolean, position]`. */
export function indexedBoolean(): Spec<[Indexed<boolean>]> {
  return leaf(Core.indexedBoolean());
}

// -- combinators --------------------------------------------------------------------------------

/**
 * Tries each alternative, yielding every successful parse best-first.
 *
 * @example
 * parse(choice([word("cat"), word("dog")]), "cat dog") // => [["cat"], ["dog"]]
 */
export function choice<const S extends readonly Nld<unknown[]>[]>(
  alternatives: S,
): Spec<ResultsOf<S[number]>> {
  return Spec.from(Core.choice(alternatives) as Nld<ResultsOf<S[number]>>);
}

/**
 * Matches `spec` zero or more times, scattered through the input, longest first. Each
 * iteration's results are appended in order.
 *
 * @example
 * parse(ignore(word("add")).repeat(nat()), "add 1 and 2 and 3") // => [[1, 2, 3], [1, 2], [1], []]
 */
export function repeat<S extends unknown[]>(spec: Nld<S>): Spec<S[number][]> {
  return Spec.from(Core.map(Core.repeat(spec), (iterations) => iterations.flat(1) as S[number][]));
}

/**
 * Matches `spec` zero or one time. The consuming parse comes first; skipping costs one.
 *
 * @example
 * parse(ignore(word("order")).optional(nat()), "order 42") // => [[42], []]
 * parse(ignore(word("order")).optional(nat()), "order") // => [[]]
 */
export function optional<S extends unknown[]>(spec: Nld<S>): Spec<[] | S> {
  return Spec.from(Core.map(Core.optional(spec), (match): [] | S => match[0] ?? []));
}

/**
 * Matches `spec` but drops its results.
 *
 * @example
 * parse(ignore(word("set")).nat(), "set the value to 42") // => [[42]]
 */
export function ignore(spec: Nld<unknown>): Spec<[]> {
  return Spec.from(Core.map(spec, (): [] => []));
}

/**
 * Wraps the results of `spec` as `[{ tag, value: results }]`.
 *
 * @example
 * parse(tag(word("set").nat(), "set"), "set 42") // => [[{ tag: "set", value: ["set", 42] }]]
 */
export function tag<S, const T>(spec: Nld<S>, name: T): Spec<[Tagged<T, S>]> {
  return Spec.from(Core.map(spec, (value): [Tagged<T, S>] => [{ tag: name, value }]));
}

/**
 * Like {@link tag} for a spec that yields exactly one result, wrapping it as
 * `[{ tag, value: result }]`. Throws at parse time if the spec yields any other number of
 * results.
 *
 * @example
 * parse(ignore(word("set")).nat().unwrapAndTag("set"), "set 42") // => [[{ tag: "set", value: 42 }]]
 */
export function unwrapAndTag<S extends unknown[], const T>(
  spec: Nld<S>,
  name: T,
): Spec<[Tagged<T, S[number]>]> {
  return Spec.from(
    Core.map(spec, (results): [Tagged<T, S[number]>] => {
      if (results.length === 1) return [{ tag: name, value: results[0] }];

      throw new Error(
        `unwrapAndTag(${show(name)}) expects exactly one result, got: ${show(results)}`,
      );
    }),
  );
}

function show(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Wraps the results of `spec` in a list, yielding `[results]`.
 *
 * @example
 * parse(wrap(word("a").word("b")).word("c"), "a b c") // => [[["a", "b"], "c"]]
 */
export function wrap<S>(spec: Nld<S>): Spec<[S]> {
  return leaf(spec);
}

/**
 * Reduces the results of `spec` to a single value with `fun`.
 *
 * @example
 * const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
 * parse(ignore(word("add")).repeat(nat()).reduce(sum), "add 1 and 2", { limit: 1 }) // => [[3]]
 */
export function reduce<S, V>(spec: Nld<S>, fun: (results: S) => V): Spec<[V]> {
  return Spec.from(Core.map(spec, (results): [V] => [fun(results)]));
}

/**
 * Applies `fun` to each result of `spec`.
 *
 * @example
 * parse(repeat(nat()).map((n) => n * 10), "1 2", { limit: 1 }) // => [[10, 20]]
 */
export function map<S extends unknown[], V>(
  spec: Nld<S>,
  fun: (item: S[number]) => V,
): Spec<MapResults<S, V>> {
  return Spec.from(
    Core.map(spec, (results) => results.map((item) => fun(item)) as MapResults<S, V>),
  );
}

/**
 * Replaces the results of `spec` with `[value]`.
 *
 * @example
 * parse(words(["yes", "yeah", "yep"]).replace(true), "yeah") // => [[true]]
 */
export function replace<const V>(spec: Nld<unknown>, value: V): Spec<[V]> {
  return Spec.from(Core.map(spec, (): [V] => [value]));
}

// -- running ------------------------------------------------------------------------------------

/**
 * Runs `spec` on the input, lazily yielding `[weight, results]` best-first.
 *
 * @example
 * [...run(word("set").nat(), "set the value to 42")] // => [[4, ["set", 42]]]
 */
export function run<T>(
  spec: Nld<T>,
  input: Input,
  opts: RunOptions = {},
): Generator<[weight: number, results: T], void, undefined> {
  return Core.run(spec, toTokens(input, opts));
}

/**
 * Runs `spec` and returns every parse's results, best first (`limit: n` for the top `n`).
 *
 * @example
 * parse(word("set").nat(), "Set the value to 42") // => [["set", 42]]
 * parse(word("set").nat(), "Set the value to 42", { downcase: false }) // => []
 * parse(word("cat"), ["cat", "dog", "cat"], { limit: 1 }) // => [["cat"]]
 */
export function parse<T>(spec: Nld<T>, input: Input, opts: LimitOptions = {}): T[] {
  const tokens = toTokens(input, opts);
  return opts.limit == null ? Core.runList(spec, tokens) : Core.runTake(spec, tokens, opts.limit);
}

/**
 * The results of the best parse, or `null` when nothing parses.
 *
 * @example
 * best(word("cat"), "the cat sat") // => ["cat"]
 * best(word("cat"), "the dog sat") // => null
 */
export function best<T>(spec: Nld<T>, input: Input, opts: RunOptions = {}): T | null {
  const [top] = Core.runTake(spec, toTokens(input, opts), 1);
  return top ?? null;
}

/**
 * Runs `spec` and, wherever it gets stuck, yields `[weight, tokens]`: the tokens that would let
 * that branch continue. Nothing is emitted for branches that succeed. See
 * {@link Core.autocomplete}.
 */
export function autocomplete(
  spec: Nld<unknown>,
  input: Input,
  opts: RunOptions = {},
): Generator<[weight: number, tokens: string[]], void, undefined> {
  return Core.autocomplete(spec, toTokens(input, opts));
}

/**
 * The top suggestion lists (default `limit: 5`) for an incomplete input: which tokens would
 * help it parse. Empty when the input already parses.
 *
 * @example
 * const buy = word("buy").word("apples");
 * suggest(buy, "") // => [["buy"]]
 * suggest(buy, "buy") // => [["apples"]]
 * suggest(buy, "buy apples") // => []
 */
export function suggest(spec: Nld<unknown>, input: Input, opts: LimitOptions = {}): string[][] {
  return Core.topK(spec, toTokens(input, opts), opts.limit ?? 5);
}

/** The {@link Grammar} describing what the spec expects. See {@link Core.grammar}. */
export function grammar(spec: Nld<unknown>): Grammar {
  return Core.grammar(spec);
}

/** The tokens the spec is looking for next. See {@link Core.wanted}. */
export function wanted(spec: Nld<unknown>): ReadonlySet<string> {
  return Core.wanted(spec);
}

function toTokens(input: Input, opts: RunOptions): readonly string[] {
  if (typeof input !== "string") return input;

  const tokens = (opts.tokenizer ?? tokenize)(input);
  return (opts.downcase ?? true) ? tokens.map(downcase) : tokens;
}
