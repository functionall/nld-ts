/**
 * `Nld` combinators.
 *
 * Parsers built here yield *bare* values (`word("x")` yields `"x"`, `tuple2` yields a pair),
 * exactly like the Unison library, which makes upstream examples portable one-to-one. Most
 * applications will prefer the chainable builders of the package entry point, which are
 * implemented on top of this module.
 *
 * A parser is a resumable step machine, {@link Nld}, in one of two states:
 *
 *   - `done`: finished, with the tokens left over and the position of the furthest token
 *     consumed;
 *   - `more`: needs input; `k(remaining, lastPos)` returns either the next `Nld` or a weighted
 *     fork `{ fork: [[weight, thunk]] }` of alternatives (`{ fork: [] }` is a dead branch).
 *
 * {@link run} explores forks best-first (lowest total weight first, ties first-in-first-out),
 * lazily yielding every successful parse in priority order.
 *
 * @module
 */

import * as Engine from "./engine.js";
import { Grammar, tokenType, type TokenType, type TokenTypeName } from "./grammar.js";
import { Nld, type Continuation, type Fork, type Outcome, type ValueOf } from "./parser.js";
import { TokenPositions } from "./token-positions.js";
import { downcase } from "./tokenizer.js";

export { Nld } from "./parser.js";
export type { Alternative, Continuation, Fork, Outcome, Step, ValueOf } from "./parser.js";

/** A token alternative and its base weight, for {@link minimalToken}. */
export type WeightedToken = readonly [weight: number, token: string];

/** Parses a token into a value, or returns `undefined` to reject it. See {@link tokenOfType}. */
export type TokenParser<T> = (token: string) => T | undefined;

/** A value together with the position of the token it was parsed from. */
export type Indexed<T> = [value: T, position: number];

const FAIL: Fork<never> = { fork: [] };
const NOTHING_WANTED: ReadonlySet<string> = new Set();

// -- helpers ------------------------------------------------------------------------------------

function done<T>(value: T, remaining: TokenPositions, lastPos: number): Nld<T> {
  return new Nld({ kind: "done", value, remaining, lastPos });
}

function more<T>(grammar: Grammar, wanted: ReadonlySet<string>, k: Continuation<T>): Nld<T> {
  return new Nld({ kind: "more", grammar, wanted, k });
}

// Continue a computation over an outcome, threading it through any forks.
function bind<A, B>(outcome: Outcome<A>, fun: (nld: Nld<A>) => Outcome<B>): Outcome<B> {
  if (outcome instanceof Nld) return fun(outcome);
  return { fork: outcome.fork.map(([weight, thunk]) => [weight, () => bind(thunk(), fun)]) };
}

// A two-level fork reproducing upstream `weightedRange`: every offset is queued at the current
// weight (FIFO), then each one forks again by its own weight.
function rangeFork<T>(
  weightedOffsets: readonly (readonly [number, number])[],
  cont: (offset: number) => Outcome<T>,
): Fork<T> {
  return {
    fork: weightedOffsets.map(([weight, offset]) => [
      0,
      () => ({ fork: [[weight, () => cont(offset)]] }),
    ]),
  };
}

// -- leaves -------------------------------------------------------------------------------------

/**
 * Always succeeds with `value` without consuming any tokens.
 *
 * @example
 * runList(pure(42), ["any", "tokens"]) // => [42]
 * runList(pure("hello"), []) // => ["hello"]
 */
export function pure<T>(value: T): Nld<T> {
  return more(Grammar.seq([]), NOTHING_WANTED, (remaining, lastPos) => done(value, remaining, lastPos));
}

/**
 * Matches one occurrence of `word` anywhere in the input, returning it with its position.
 * Closer occurrences are preferred; every occurrence yields a parse.
 *
 * @example
 * runList(indexedWord("cat"), ["the", "cat", "sat"]) // => [["cat", 1]]
 * runList(indexedWord("the"), ["the", "cat", "saw", "the", "dog"]) // => [["the", 0], ["the", 3]]
 */
export function indexedWord(word: string): Nld<Indexed<string>> {
  return more({ tag: "literal", value: word }, new Set([word]), (remaining, prev) => ({
    fork: remaining
      .positions(word)
      .map((pos) => [
        TokenPositions.gapCost(prev, pos),
        () => done<Indexed<string>>([word, pos], remaining.remove(word, pos), pos),
      ]),
  }));
}

/**
 * Matches any of several weighted tokens, returning the token and its position. The total cost
 * is the token's base weight plus its gap cost, so lower base weights are preferred.
 *
 * @example
 * runList(indexedMinimalToken([[0, "buy"], [1, "get"]]), ["get", "buy"])
 * // => [["buy", 1], ["get", 0]]
 */
export function indexedMinimalToken(weightedTokens: readonly WeightedToken[]): Nld<Indexed<string>> {
  const grammar: Grammar = {
    tag: "minimalToken",
    value: weightedTokens.map(([weight, text]) => ({ weight, text })),
  };

  const wanted = new Set(weightedTokens.map(([, token]) => token));

  return more(grammar, wanted, (remaining, prev) => ({
    fork: weightedTokens.flatMap(([base, token]) =>
      remaining
        .positions(token)
        .map((pos): [number, () => Nld<Indexed<string>>] => [
          base + TokenPositions.gapCost(prev, pos),
          () => done([token, pos], remaining.remove(token, pos), pos),
        ]),
    ),
  }));
}

/**
 * Matches any of the given words (treated as synonyms), returning the *first* word of the list
 * together with the match position. Later words cost one extra.
 *
 * @example
 * runList(indexedWords(["hello", "hi", "hey"]), ["hey", "there"]) // => [["hello", 0]]
 */
export function indexedWords(words: readonly string[]): Nld<Indexed<string>> {
  const [canonical, ...synonyms] = words;
  if (canonical === undefined) return indexedMinimalToken([]);

  const weighted: WeightedToken[] = [[0, canonical], ...synonyms.map((s): WeightedToken => [1, s])];
  return map(indexedMinimalToken(weighted), ([, pos]) => [canonical, pos]);
}

/**
 * Matches any token satisfying `pred`, returning it with its position. Tokens close to the
 * previous match are preferred.
 *
 * @example
 * runList(indexedTokenMatching((t) => t.startsWith("a")), ["the", "apple", "and"])
 * // => [["apple", 1], ["and", 2]]
 */
export function indexedTokenMatching(pred: (token: string) => boolean): Nld<Indexed<string>> {
  return more({ tag: "anyToken" }, NOTHING_WANTED, (remaining, prev) =>
    scanTokens(remaining, prev, (token) => (pred(token) ? token : undefined)),
  );
}

/** Matches any single token, returning it with its position. See {@link token}. */
export function indexedToken(): Nld<Indexed<string>> {
  return indexedTokenMatching(() => true);
}

/**
 * Matches a token accepted by `parse` (which returns the parsed value, or `undefined` to reject
 * the token), yielding the parsed value with its position. `type` describes the token in the
 * grammar (see {@link Grammar}).
 *
 * @example
 * const hex = indexedTokenOfType("nat", (t) => (/^[0-9a-f]+$/i.test(t) ? parseInt(t, 16) : undefined));
 * runList(hex, ["value", "ff"]) // => [[255, 1]]
 */
export function indexedTokenOfType<T>(
  type: TokenType | TokenTypeName,
  parse: TokenParser<T>,
): Nld<Indexed<T>> {
  return more({ tag: "token", value: tokenType(type) }, NOTHING_WANTED, (remaining, prev) =>
    scanTokens(remaining, prev, parse),
  );
}

// Shared by the "any token" family: try remaining positions radiating out from `prev`.
function scanTokens<T>(
  remaining: TokenPositions,
  prev: number,
  parse: TokenParser<T>,
): Outcome<Indexed<T>> {
  const bounds = remaining.bounds();
  if (bounds === null) return FAIL;

  const [minPos, maxPos] = bounds;

  return rangeFork(TokenPositions.weightedRange(minPos - prev, maxPos - prev), (offset) => {
    const pos = prev + offset;
    const token = remaining.tokenAt(pos);
    if (token === undefined) return FAIL;

    const value = parse(token);
    if (value === undefined) return FAIL;

    return done<Indexed<T>>([value, pos], remaining.remove(token, pos), pos);
  });
}

/**
 * Matches a natural number token, returning it with its position.
 *
 * @example
 * runList(indexedNat(), ["buy", "42", "apples"]) // => [[42, 1]]
 */
export function indexedNat(): Nld<Indexed<number>> {
  return indexedTokenOfType("nat", parseNat);
}

/**
 * Matches an integer token, returning it with its position.
 *
 * @example
 * runList(indexedInt(), ["sell", "-3", "items"]) // => [[-3, 1]]
 */
export function indexedInt(): Nld<Indexed<number>> {
  return indexedTokenOfType("int", parseInteger);
}

/**
 * Matches a floating-point token, returning it with its position.
 *
 * @example
 * runList(indexedFloat(), ["set", "rate", "3.14"]) // => [[3.14, 2]]
 */
export function indexedFloat(): Nld<Indexed<number>> {
  return indexedTokenOfType("float", parseFloating);
}

/** Matches `true`/`false` (case-insensitive), returning it with its position. */
export function indexedBoolean(): Nld<Indexed<boolean>> {
  return indexedTokenOfType("boolean", parseBoolean);
}

// JavaScript numbers are doubles, so integers that cannot be represented exactly are rejected
// rather than silently rounded (`+ 0` turns the `-0` of "-0" into `0`).
function safeInteger(token: string): number | undefined {
  const n = Number(token);
  return Number.isSafeInteger(n) ? n + 0 : undefined;
}

function parseNat(token: string): number | undefined {
  return /^[0-9]+$/.test(token) ? safeInteger(token) : undefined;
}

function parseInteger(token: string): number | undefined {
  return /^[+-]?[0-9]+$/.test(token) ? safeInteger(token) : undefined;
}

function parseFloating(token: string): number | undefined {
  if (!/^[+-]?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(token)) return undefined;
  const n = Number(token);
  return Number.isFinite(n) ? n : undefined;
}

function parseBoolean(token: string): boolean | undefined {
  const lower = downcase(token);
  return lower === "true" ? true : lower === "false" ? false : undefined;
}

const first = <T>([value]: Indexed<T>): T => value;

/**
 * Matches one occurrence of `word` anywhere in the input. Closer occurrences are preferred and
 * every occurrence yields a parse.
 *
 * @example
 * runList(word("cat"), ["the", "cat", "sat"]) // => ["cat"]
 * runList(word("dog"), ["the", "cat", "sat"]) // => []
 * runList(word("cat"), ["cat", "dog", "cat"]) // => ["cat", "cat"]
 */
export function word(word: string): Nld<string> {
  return map(indexedWord(word), first);
}

/**
 * Matches any of the given words, treating the rest as synonyms of the first, and returns the
 * first (canonical) word.
 *
 * @example
 * runTake(tuple2(words(["hello", "hi"]), token()), ["hi", "world"], 1) // => [["hello", "world"]]
 */
export function words(words: readonly string[]): Nld<string> {
  return map(indexedWords(words), first);
}

/**
 * Matches any of several weighted tokens; lower base weight plus gap cost wins.
 *
 * @example
 * runTake(minimalToken([[0, "buy"], [0, "purchase"], [1, "get"]]), ["get", "buy"], 1) // => ["buy"]
 * runList(minimalToken([[0, "yes"], [0, "no"]]), ["yes"]) // => ["yes"]
 */
export function minimalToken(weightedTokens: readonly WeightedToken[]): Nld<string> {
  return map(indexedMinimalToken(weightedTokens), first);
}

/**
 * Matches any single token, preferring tokens close to the previous match.
 *
 * @example
 * runList(token(), ["hello"]) // => ["hello"]
 * runList(token(), ["a", "b", "c"]) // => ["a", "b", "c"]
 */
export function token(): Nld<string> {
  return map(indexedToken(), first);
}

/**
 * Matches any token satisfying `pred`.
 *
 * @example
 * runList(tokenMatching((t) => t.startsWith("a")), ["apple", "banana", "avocado"])
 * // => ["apple", "avocado"]
 * runList(tokenMatching((t) => t.startsWith("z")), ["apple", "banana"]) // => []
 */
export function tokenMatching(pred: (token: string) => boolean): Nld<string> {
  return map(indexedTokenMatching(pred), first);
}

/** Matches a token accepted by `parse`. See {@link indexedTokenOfType}. */
export function tokenOfType<T>(type: TokenType | TokenTypeName, parse: TokenParser<T>): Nld<T> {
  return map(indexedTokenOfType(type, parse), first);
}

/**
 * Matches a natural number. Numbers too large to be represented exactly
 * (`Number.MAX_SAFE_INTEGER`) do not match; capture those with {@link tokenOfType}.
 *
 * @example
 * runList(nat(), ["42"]) // => [42]
 * runList(nat(), ["buy", "5", "apples"]) // => [5]
 * runList(nat(), ["hello", "world"]) // => []
 */
export function nat(): Nld<number> {
  return map(indexedNat(), first);
}

/**
 * Matches an integer.
 *
 * @example
 * runList(int(), ["set", "offset", "to", "-3"]) // => [-3]
 */
export function int(): Nld<number> {
  return map(indexedInt(), first);
}

/**
 * Matches a floating-point number.
 *
 * @example
 * runList(float(), ["set", "rate", "to", "2.5"]) // => [2.5]
 */
export function float(): Nld<number> {
  return map(indexedFloat(), first);
}

/**
 * Matches `true` or `false`, case-insensitively.
 *
 * @example
 * runList(boolean(), ["set", "verbose", "True"]) // => [true]
 */
export function boolean(): Nld<boolean> {
  return map(indexedBoolean(), first);
}

// -- combinators --------------------------------------------------------------------------------

/**
 * Transforms the result of a parser.
 *
 * @example
 * runList(map(word("hello"), (w) => w.toUpperCase()), ["hello"]) // => ["HELLO"]
 * runList(map(nat(), (n) => n * 2), ["5"]) // => [10]
 */
export function map<A, B>(nld: Nld<A>, fun: (value: A) => B): Nld<B> {
  const { step } = nld;
  if (step.kind === "done") return done(fun(step.value), step.remaining, step.lastPos);

  return more(step.grammar, step.wanted, (remaining, lastPos) =>
    bind(step.k(remaining, lastPos), (next) => map(next, fun)),
  );
}

/**
 * Runs both parsers and combines their results with `fun`. Their tokens may appear in either
 * order in the input (the specified order is preferred), and each parser consumes its own tokens.
 *
 * @example
 * const pair = (a: string, b: string) => [a, b];
 * runList(map2(word("red"), word("ball"), pair), ["red", "ball"]) // => [["red", "ball"]]
 * runList(map2(word("red"), word("ball"), pair), ["ball", "red"]) // => [["red", "ball"]]
 * runList(map2(word("a"), word("a"), pair), ["a", "a"]) // => [["a", "a"], ["a", "a"]]
 */
export function map2<A, B, C>(na: Nld<A>, nb: Nld<B>, fun: (a: A, b: B) => C): Nld<C> {
  const a = na.step;
  const b = nb.step;

  if (a.kind === "more") {
    return more(Grammar.seq([a.grammar, grammar(nb)]), a.wanted, (remaining, lastPos) =>
      bind(a.k(remaining, lastPos), (next) => map2(next, nb, fun)),
    );
  }

  // The second parser resumes from the first one's state, whatever state it is called with.
  if (b.kind === "more") {
    return more(b.grammar, b.wanted, () =>
      bind(b.k(a.remaining, a.lastPos), (next) => map2(na, next, fun)),
    );
  }

  return done(fun(a.value, b.value), b.remaining, Math.max(a.lastPos, b.lastPos));
}

/** Runs three parsers and combines their results with `fun`. See {@link map2}. */
export function map3<A, B, C, D>(
  na: Nld<A>,
  nb: Nld<B>,
  nc: Nld<C>,
  fun: (a: A, b: B, c: C) => D,
): Nld<D> {
  return map2(
    map2(na, nb, (a, b) => (c: C) => fun(a, b, c)),
    nc,
    (g, c) => g(c),
  );
}

/**
 * Runs two parsers and returns their results as a pair.
 *
 * @example
 * runList(tuple2(word("name"), token()), ["name", "Alice"]) // => [["name", "Alice"]]
 * runList(tuple2(word("set"), nat()), ["can", "you", "set", "the", "value", "to", "42"])
 * // => [["set", 42]]
 */
export function tuple2<A, B>(na: Nld<A>, nb: Nld<B>): Nld<[A, B]> {
  return map2(na, nb, (a, b) => [a, b]);
}

/**
 * Runs three parsers and returns their results as a triple.
 *
 * @example
 * runList(tuple3(word("set"), token(), nat()), ["set", "x", "42"]) // => [["set", "x", 42]]
 * runList(tuple3(word("move"), token(), word("to")), ["to", "backup", "move"])
 * // => [["move", "backup", "to"]]
 */
export function tuple3<A, B, C>(na: Nld<A>, nb: Nld<B>, nc: Nld<C>): Nld<[A, B, C]> {
  return map3(na, nb, nc, (a, b, c) => [a, b, c]);
}

/**
 * Runs each parser and collects the results into a list.
 *
 * @example
 * runList(sequence([word("a"), word("b")]), ["a", "b"]) // => [["a", "b"]]
 * runList(
 *   sequence([words(["remove", "delete", "erase"]), words(["file", "document"])]),
 *   ["please", "erase", "the", "document"],
 * ) // => [["remove", "file"]]
 * runList(sequence([]), ["hello"]) // => [[]]
 */
export function sequence<T>(nlds: readonly Nld<T>[]): Nld<T[]> {
  return nlds.reduceRight((acc, nld) => map2(nld, acc, (x, xs) => [x, ...xs]), pure<T[]>([]));
}

/**
 * Matches all of the words (in any order, the given order preferred) and returns them joined by
 * spaces.
 *
 * @example
 * runList(phrase(["delete", "file"]), ["please", "delete", "the", "file"]) // => ["delete file"]
 * runList(tuple2(phrase(["set", "volume"]), nat()), ["set", "the", "volume", "to", "11"])
 * // => [["set volume", 11]]
 * runList(phrase([]), ["hello"]) // => [""]
 */
export function phrase(words: readonly string[]): Nld<string> {
  return map(sequence(words.map(word)), (matched) => matched.join(" "));
}

/**
 * Tries each parser, returning every successful parse (best first).
 *
 * @example
 * runList(choice([word("yes"), word("yeah"), word("yep")]), ["yeah"]) // => ["yeah"]
 * runList(choice([word("cat"), word("dog")]), ["cat", "dog"]) // => ["cat", "dog"]
 * runList(choice([word("cat"), word("dog")]), ["bird"]) // => []
 */
export function choice<const N extends readonly Nld<unknown>[]>(nlds: N): Nld<ValueOf<N[number]>>;
export function choice(nlds: readonly Nld<unknown>[]): Nld<unknown> {
  if (nlds.length === 0) return more(Grammar.seq([]), NOTHING_WANTED, () => FAIL);
  if (nlds.length === 1) return nlds[0]!;

  const allWanted = new Set(nlds.flatMap((nld) => [...wanted(nld)]));

  return more(Grammar.choice(nlds.map(grammar)), allWanted, (remaining, lastPos) => ({
    fork: nlds.map((nld) => [0, () => step(nld, remaining, lastPos)]),
  }));
}

// One step of a parser from an explicit state (upstream: `choice [k remaining lastPos]`).
function step<T>(nld: Nld<T>, remaining: TokenPositions, lastPos: number): Outcome<T> {
  return nld.step.kind === "done" ? nld : nld.step.k(remaining, lastPos);
}

/**
 * Matches zero or more occurrences scattered through the input, longest match first. Each
 * omitted occurrence costs one.
 *
 * Throws if `nld` can match without consuming a token (for example `repeat(pure(1))`), which
 * would otherwise repeat forever.
 *
 * @example
 * runList(repeat(word("cat")), ["cat", "cat"]) // => [["cat", "cat"], ["cat"], []]
 * runList(repeat(nat()), ["a", "1", "b", "2", "c", "3"]) // => [[1, 2, 3], [1, 2], [1], []]
 * runTake(repeat(word("cat")), ["dog"], 1) // => [[]]
 */
export function repeat<T>(nld: Nld<T>): Nld<T[]> {
  return more({ tag: "repeat", value: grammar(nld) }, wanted(nld), (remaining, lastPos) => {
    const items: T[] = [];

    for (;;) {
      const match = firstForwardMatch(nld, remaining, lastPos);
      if (match === undefined) break;

      if (match[1] === remaining) {
        throw new Error("repeat: the repeated parser matched without consuming a token");
      }

      items.push(match[0]);
      [, remaining, lastPos] = match;
    }

    const finalRemaining = remaining;
    const finalPos = lastPos;

    return {
      fork: Array.from({ length: items.length + 1 }, (_, dropped) => [
        dropped,
        () => done(items.slice(0, items.length - dropped), finalRemaining, finalPos),
      ]),
    };
  });
}

// Best parse of `nld` from the given state whose match position does not go backwards.
function firstForwardMatch<T>(
  nld: Nld<T>,
  remaining: TokenPositions,
  lastPos: number,
): Engine.Parsed<T> | undefined {
  for (const [, parsed] of Engine.runFrom(nld, remaining, lastPos)) {
    if (parsed[2] >= lastPos) return parsed;
  }

  return undefined;
}

/**
 * Matches zero or one occurrence, using the same mechanics as {@link repeat}: the consuming
 * parse costs nothing extra and comes first; skipping costs one and leaves the input untouched.
 * Yields a list of at most one element. (Not in upstream.)
 *
 * @example
 * runList(optional(nat()), ["set", "42"]) // => [[42], []]
 * runList(optional(nat()), ["set"]) // => [[]]
 */
export function optional<T>(nld: Nld<T>): Nld<[] | [T]> {
  const either = Grammar.choice([grammar(nld), Grammar.seq([])]);

  return more<[] | [T]>(either, wanted(nld), (remaining, lastPos) => {
    const match = firstForwardMatch(nld, remaining, lastPos);
    if (match === undefined) return done([], remaining, lastPos);

    const [value, remainingAfter, pos] = match;

    return {
      fork: [
        [0, () => done([value], remainingAfter, pos)],
        [1, () => done([], remaining, lastPos)],
      ],
    };
  });
}

/**
 * Adds a fixed cost to every parse of `nld`, useful for biasing {@link choice} alternatives.
 * (Not in upstream.)
 *
 * @example
 * runList(choice([weight(word("a"), 5), word("b")]), ["a", "b"]) // => ["b", "a"]
 */
export function weight<T>(nld: Nld<T>, cost: number): Nld<T> {
  return more(grammar(nld), wanted(nld), (remaining, lastPos) => ({
    fork: [[cost, () => step(nld, remaining, lastPos)]],
  }));
}

// -- introspection ------------------------------------------------------------------------------

/**
 * The {@link Grammar} describing what the parser expects.
 *
 * @example
 * grammar(word("hello")) // => { tag: "literal", value: "hello" }
 * grammar(tuple2(word("buy"), nat()))
 * // => { tag: "seq", value: [{ tag: "literal", value: "buy" }, { tag: "token", value: { tag: "nat" } }] }
 * grammar(choice([word("yes"), word("no")]))
 * // => { tag: "choice", value: [{ tag: "literal", value: "yes" }, { tag: "literal", value: "no" }] }
 */
export function grammar(nld: Nld<unknown>): Grammar {
  return nld.step.kind === "done" ? Grammar.seq([]) : nld.step.grammar;
}

/**
 * The set of tokens the parser is looking for next.
 *
 * @example
 * wanted(word("hello")) // => Set { "hello" }
 * wanted(tuple2(word("a"), word("b"))) // => Set { "a" }
 */
export function wanted(nld: Nld<unknown>): ReadonlySet<string> {
  return nld.step.kind === "done" ? NOTHING_WANTED : nld.step.wanted;
}

// -- runners ------------------------------------------------------------------------------------

/**
 * Runs the parser on a token list, lazily yielding `[weight, result]` pairs best-first
 * (lowest weight first).
 *
 * @example
 * [...run(word("cat"), ["cat"])] // => [[0, "cat"]]
 * [...run(tuple2(indexedWord("the"), word("cat")), ["the", "cat", "saw", "the", "dog"])]
 * // => [[1, [["the", 0], "cat"]], [7.5, [["the", 3], "cat"]]]
 */
export function run<T>(
  nld: Nld<T>,
  tokens: readonly string[],
): Generator<[weight: number, result: T], void, undefined> {
  return Engine.run(nld, TokenPositions.fromList(tokens));
}

/**
 * Runs the parser and returns all results, best first.
 *
 * @example
 * runList(word("cat"), ["the", "cat"]) // => ["cat"]
 * runList(tuple2(word("hello"), token()), ["world", "says", "hello"])
 * // => [["hello", "says"], ["hello", "world"]]
 */
export function runList<T>(nld: Nld<T>, tokens: readonly string[]): T[] {
  return Array.from(run(nld, tokens), ([, result]) => result);
}

/**
 * Runs the parser and returns up to `count` results, best first.
 *
 * @example
 * runTake(word("cat"), ["cat", "cat", "cat"], 1) // => ["cat"]
 * runTake(tuple2(word("a"), word("b")), ["a", "b", "a", "b"], 2) // => [["a", "b"], ["a", "b"]]
 */
export function runTake<T>(nld: Nld<T>, tokens: readonly string[], count: number): T[] {
  return take(run(nld, tokens), count).map(([, result]) => result);
}

/**
 * Runs the parser and, wherever it gets stuck, yields `[weight, tokens]`: the tokens that would
 * let that branch continue. Nothing is emitted for branches that succeed.
 *
 * @example
 * [...autocomplete(word("cat"), [])] // => [[0, ["cat"]]]
 * [...autocomplete(word("cat"), ["cat"])] // => []
 * [...autocomplete(tuple2(word("buy"), word("apples")), ["buy"])] // => [[0, ["apples"]]]
 */
export function autocomplete(
  nld: Nld<unknown>,
  tokens: readonly string[],
): Generator<[weight: number, tokens: string[]], void, undefined> {
  return Engine.autocomplete(nld, TokenPositions.fromList(tokens));
}

/**
 * The top `count` non-empty suggestion lists from {@link autocomplete}.
 *
 * @example
 * topK(word("cat"), [], 5) // => [["cat"]]
 * topK(word("cat"), ["cat"], 5) // => []
 * topK(tuple2(word("buy"), word("apples")), ["buy"], 5) // => [["apples"]]
 * topK(choice([word("cat"), word("dog")]), [], 5) // => [["cat", "dog"], ["cat", "dog"]]
 */
export function topK(nld: Nld<unknown>, tokens: readonly string[], count: number): string[][] {
  return take(nonEmpty(autocomplete(nld, tokens)), count).map(([, suggestions]) => suggestions);
}

function* nonEmpty<W>(entries: Iterable<[W, string[]]>): Generator<[W, string[]], void, undefined> {
  for (const entry of entries) if (entry[1].length > 0) yield entry;
}

// Stops as soon as `count` items are in hand, so nothing beyond them is ever computed.
function take<T>(items: Iterable<T>, count: number): T[] {
  const taken: T[] = [];
  if (count <= 0) return taken;

  for (const item of items) {
    taken.push(item);
    if (taken.length >= count) break;
  }

  return taken;
}
