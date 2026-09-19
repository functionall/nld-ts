// Interprets the spec DSL of test/fixtures/conformance.json against this library.

import * as N from "../../src/index.js";
import { Core, type Nld, type Spec } from "../../src/index.js";

export type Dsl = readonly [op: string, ...args: unknown[]];

type AnySpec = Spec<unknown[]>;

// -- core layer: bare values --------------------------------------------------------------------

export function core(dsl: Dsl): Nld<unknown> {
  const [op, a, b, c] = dsl;

  switch (op) {
    case "pure":
      return Core.pure(a);
    case "word":
      return Core.word(a as string);
    case "words":
      return Core.words(a as string[]);
    case "minimal_token":
      return Core.minimalToken(a as Core.WeightedToken[]);
    case "token":
      return Core.token();
    case "token_matching":
      return Core.tokenMatching(pred(a as Dsl));
    case "nat":
      return Core.nat();
    case "int":
      return Core.int();
    case "float":
      return Core.float();
    case "boolean":
      return Core.boolean();
    case "indexed_word":
      return Core.indexedWord(a as string);
    case "indexed_words":
      return Core.indexedWords(a as string[]);
    case "indexed_minimal_token":
      return Core.indexedMinimalToken(a as Core.WeightedToken[]);
    case "indexed_token":
      return Core.indexedToken();
    case "indexed_token_matching":
      return Core.indexedTokenMatching(pred(a as Dsl));
    case "indexed_nat":
      return Core.indexedNat();
    case "indexed_int":
      return Core.indexedInt();
    case "indexed_float":
      return Core.indexedFloat();
    case "indexed_boolean":
      return Core.indexedBoolean();
    case "map":
      return Core.map(core(a as Dsl), fun(b as string));
    case "tuple2":
      return Core.tuple2(core(a as Dsl), core(b as Dsl));
    case "tuple3":
      return Core.tuple3(core(a as Dsl), core(b as Dsl), core(c as Dsl));
    case "sequence":
      return Core.sequence((a as Dsl[]).map(core));
    case "phrase":
      return Core.phrase(a as string[]);
    case "choice":
      return Core.choice((a as Dsl[]).map(core));
    case "repeat":
      return Core.repeat(core(a as Dsl));
    case "optional":
      return Core.optional(core(a as Dsl));
    case "weight":
      return Core.weight(core(a as Dsl), b as number);
    default:
      throw new Error(`unknown core op: ${op}`);
  }
}

// -- pipe layer: a list of steps, folded left into one chain ------------------------------------

export function pipe(steps: readonly Dsl[]): AnySpec {
  return steps.reduce<AnySpec | null>(step, null) ?? N.empty();
}

// The first step uses the function form of a builder and every later one the method form, so
// both are held to the recorded results.
function step(prev: AnySpec | null, dsl: Dsl): AnySpec {
  const [op, ...args] = dsl;

  switch (op) {
    case "word":
      return prev ? prev.word(args[0] as string) : N.word(args[0] as string);
    case "words":
      return prev ? prev.words(args[0] as string[]) : N.words(args[0] as string[]);
    case "minimal_token": {
      const pairs = args[0] as Core.WeightedToken[];
      return prev ? prev.minimalToken(pairs) : N.minimalToken(pairs);
    }
    case "phrase":
      return prev ? prev.phrase(args[0] as string[]) : N.phrase(args[0] as string[]);
    case "token":
      return prev ? prev.token() : N.token();
    case "token_matching": {
      const accept = pred(args[0] as Dsl);
      return prev ? prev.tokenMatching(accept) : N.tokenMatching(accept);
    }
    case "nat":
      return prev ? prev.nat() : N.nat();
    case "int":
      return prev ? prev.int() : N.int();
    case "float":
      return prev ? prev.float() : N.float();
    case "boolean":
      return prev ? prev.boolean() : N.boolean();
    case "indexed_word":
      return prev ? prev.indexedWord(args[0] as string) : N.indexedWord(args[0] as string);
    case "indexed_words":
      return prev ? prev.indexedWords(args[0] as string[]) : N.indexedWords(args[0] as string[]);
    case "indexed_token":
      return prev ? prev.indexedToken() : N.indexedToken();
    case "indexed_nat":
      return prev ? prev.indexedNat() : N.indexedNat();
    case "choice": {
      const alternatives = (args[0] as Dsl[][]).map(pipe);
      return prev ? prev.choice(alternatives) : N.choice(alternatives);
    }
    case "repeat":
      return prev ? prev.repeat(pipe(args[0] as Dsl[])) : N.repeat(pipe(args[0] as Dsl[]));
    case "optional":
      return prev ? prev.optional(pipe(args[0] as Dsl[])) : N.optional(pipe(args[0] as Dsl[]));
    case "ignore":
      return prev ? prev.ignore(pipe(args[0] as Dsl[])) : N.ignore(pipe(args[0] as Dsl[]));
    case "wrap":
      return prev ? prev.wrap(pipe(args[0] as Dsl[])) : N.wrap(pipe(args[0] as Dsl[]));
  }

  // Shaping steps: with one argument they apply to everything so far, with two they continue
  // with their own spec.
  if (args.length === 1) {
    const soFar = prev ?? N.empty();
    const [arg] = args;

    switch (op) {
      case "tag":
        return soFar.tag(arg);
      case "unwrap_and_tag":
        return soFar.unwrapAndTag(arg);
      case "reduce":
        return soFar.reduce(fun(arg as string));
      case "map":
        return soFar.map(fun(arg as string));
      case "replace":
        return soFar.replace(arg);
    }
  } else {
    const spec = pipe(args[0] as Dsl[]);
    const arg = args[1];

    switch (op) {
      case "tag":
        return prev ? prev.tag(spec, arg) : N.tag(spec, arg);
      case "unwrap_and_tag":
        return prev ? prev.unwrapAndTag(spec, arg) : N.unwrapAndTag(spec, arg);
      case "reduce":
        return prev ? prev.reduce(spec, fun(arg as string)) : N.reduce(spec, fun(arg as string));
      case "map":
        return prev ? prev.map(spec, fun(arg as string)) : N.map(spec, fun(arg as string));
      case "replace":
        return prev ? prev.replace(spec, arg) : N.replace(spec, arg);
    }
  }

  throw new Error(`unknown pipe step: ${JSON.stringify(dsl)}`);
}

// -- named functions and predicates -------------------------------------------------------------

function pred([name, arg]: Dsl): (token: string) => boolean {
  switch (name) {
    case "starts_with":
      return (token) => token.startsWith(arg as string);
    case "longer_than":
      // The fixtures count graphemes; their vocabulary is ASCII, so code units agree.
      return (token) => token.length > (arg as number);
    default:
      throw new Error(`unknown predicate: ${name}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fun(name: string): (value: any) => unknown {
  switch (name) {
    case "wrap":
      return (value) => [value];
    case "const":
      return () => "K";
    case "count":
      return (results: unknown[]) => results.length;
    case "join":
      return (results: unknown[]) => results.join(" ");
    default:
      throw new Error(`unknown function: ${name}`);
  }
}
