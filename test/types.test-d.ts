// Type-level tests: what TypeScript infers for the results of a spec. Checked by `vitest
// --typecheck` (part of `pnpm test`); nothing here runs.

import { describe, expectTypeOf, test } from "vitest";
import {
  best,
  choice,
  Core,
  ignore,
  indexedNat,
  nat,
  optional,
  parse,
  repeat,
  run,
  type Spec,
  type Tagged,
  word,
  words,
  wrap,
} from "../src/index.js";

describe("spec result types", () => {
  test("leaves accumulate into a tuple", () => {
    expectTypeOf(word("a").nat().boolean()).toEqualTypeOf<Spec<[string, number, boolean]>>();
    expectTypeOf(indexedNat()).toEqualTypeOf<Spec<[[value: number, position: number]]>>();
  });

  test("ignore contributes nothing", () => {
    expectTypeOf(ignore(word("set")).nat()).toEqualTypeOf<Spec<[number]>>();
    expectTypeOf(word("a").ignore(word("b"))).toEqualTypeOf<Spec<[string]>>();
  });

  test("repeat and optional", () => {
    expectTypeOf(repeat(nat())).toEqualTypeOf<Spec<number[]>>();
    expectTypeOf(word("add").repeat(nat())).toEqualTypeOf<Spec<[string, ...number[]]>>();
    expectTypeOf(optional(nat())).toEqualTypeOf<Spec<[] | [number]>>();
    expectTypeOf(parse(word("order").optional(nat()), "")).toEqualTypeOf<([string] | [string, number])[]>();
  });

  test("shaping", () => {
    expectTypeOf(word("a").nat().tag("pair")).toEqualTypeOf<Spec<[Tagged<"pair", [string, number]>]>>();
    expectTypeOf(ignore(word("set")).nat().unwrapAndTag("n")).toEqualTypeOf<Spec<[Tagged<"n", number>]>>();
    expectTypeOf(word("a").tag(nat(), "n")).toEqualTypeOf<Spec<[string, Tagged<"n", [number]>]>>();
    expectTypeOf(wrap(word("a").nat()).word("c")).toEqualTypeOf<Spec<[[string, number], string]>>();
    expectTypeOf(repeat(nat()).reduce((ns) => ns.length > 0)).toEqualTypeOf<Spec<[boolean]>>();
    expectTypeOf(word("a").nat().map(String)).toEqualTypeOf<Spec<[string, string]>>();
    expectTypeOf(words(["yes", "yeah"]).replace(true)).toEqualTypeOf<Spec<[true]>>();
  });

  test("a choice of tagged intents is a discriminated union", () => {
    const cancel = ignore(word("cancel")).optional(nat()).tag("cancel_order");
    const hours = ignore(word("hours")).tag("store_hours");
    const intents = choice([cancel, hours]);

    const result = best(intents, "cancel order 42");
    expectTypeOf(result).toEqualTypeOf<
      [Tagged<"cancel_order", [] | [number]>] | [Tagged<"store_hours", []>] | null
    >();

    if (result !== null) {
      const [intent] = result;

      if (intent.tag === "cancel_order") {
        expectTypeOf(intent.value).toEqualTypeOf<[] | [number]>();
      } else {
        expectTypeOf(intent.tag).toEqualTypeOf<"store_hours">();
        expectTypeOf(intent.value).toEqualTypeOf<[]>();
      }
    }
  });

  test("the README's claim about its opening example", () => {
    const cancel = ignore(words(["cancel", "stop", "halt"])).ignore(word("order")).optional(nat()).tag("cancel_order");
    const status = ignore(word("order")).ignore(word("status")).optional(nat()).tag("order_status");

    expectTypeOf(best(choice([cancel, status]), "")).toEqualTypeOf<
      [Tagged<"cancel_order", [] | [number]>] | [Tagged<"order_status", [] | [number]>] | null
    >();
  });

  test("runners", () => {
    const spec = word("a").nat();
    expectTypeOf(parse(spec, "")).toEqualTypeOf<[string, number][]>();
    expectTypeOf(best(spec, "")).toEqualTypeOf<[string, number] | null>();
    expectTypeOf(spec.best("")).toEqualTypeOf<[string, number] | null>();
    expectTypeOf([...run(spec, "")]).toEqualTypeOf<[weight: number, results: [string, number]][]>();
  });
});

describe("core result types", () => {
  test("bare values", () => {
    expectTypeOf(Core.tuple2(Core.word("buy"), Core.nat())).toEqualTypeOf<Core.Nld<[string, number]>>();
    expectTypeOf(Core.choice([Core.word("a"), Core.nat()])).toEqualTypeOf<Core.Nld<string | number>>();
    expectTypeOf(Core.repeat(Core.nat())).toEqualTypeOf<Core.Nld<number[]>>();
    expectTypeOf(Core.optional(Core.boolean())).toEqualTypeOf<Core.Nld<[] | [boolean]>>();
    expectTypeOf(Core.runList(Core.float(), [])).toEqualTypeOf<number[]>();

    const big = Core.tokenOfType("nat", (t) => (/^[0-9]+$/.test(t) ? BigInt(t) : undefined));
    expectTypeOf(big).toEqualTypeOf<Core.Nld<bigint>>();
  });
});
