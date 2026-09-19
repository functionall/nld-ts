import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { Core, parse, repeat, token, word } from "../src/index.js";

const { choice, map, map2, minimalToken, pure, run, runList, tuple2 } = Core;

const pair = <A, B>(a: A, b: B): [A, B] => [a, b];
const times = (token_: string, count: number): string[] => Array<string>(count).fill(token_);

describe("properties", () => {
  test("pure always returns exactly one result", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 5 }), (n, count) => {
        expect(runList(pure(n), times("tok", count))).toEqual([n]);
      }),
    );
  });

  test("word returns count equal to occurrences", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 3 }), (occurrences, others) => {
        const tokens = [...times("other", others), ...times("target", occurrences)];
        expect(runList(Core.word("target"), tokens)).toHaveLength(occurrences);
      }),
    );
  });

  test("map with the identity function is the identity", () => {
    const alphanumeric = fc.stringMatching(/^[a-zA-Z0-9]*$/);

    fc.assert(
      fc.property(fc.array(alphanumeric, { maxLength: 4 }), (extra) => {
        const tokens = ["test", ...extra];
        expect(runList(map(Core.word("test"), (v) => v), tokens)).toEqual(runList(Core.word("test"), tokens));
      }),
    );
  });

  test("map2 with distinct words produces the product of the counts", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 3 }), (count1, count2) => {
        const tokens = [...times("alpha", count1), ...times("beta", count2)];
        expect(runList(map2(Core.word("alpha"), Core.word("beta"), pair), tokens)).toHaveLength(count1 * count2);
      }),
    );
  });

  test("minimalToken returns the sum of the occurrences", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 3 }), (count1, count2) => {
        const tokens = [...times("alpha", count1), ...times("beta", count2)];
        expect(runList(minimalToken([[0, "alpha"], [0, "beta"]]), tokens)).toHaveLength(count1 + count2);
      }),
    );
  });

  test("token captures each position exactly once", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (n) => {
        expect(runList(Core.token(), times("x", n))).toHaveLength(n);
      }),
    );
  });

  test("multiple occurrences produce multiple parses", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 5 }), (n) => {
        expect(runList(Core.word("word"), times("word", n))).toHaveLength(n);
      }),
    );
  });

  test("results are ordered by non-decreasing weight", () => {
    const tokens = fc.array(fc.constantFrom("a", "b", "c", "d"), { minLength: 1, maxLength: 6 });

    fc.assert(
      fc.property(tokens, (input) => {
        const spec = tuple2(choice([Core.word("a"), Core.word("b")]), Core.token());
        const weights = Array.from(run(spec, input), ([weight]) => weight);
        expect(weights).toEqual([...weights].sort((x, y) => x - y));
      }),
    );
  });

  // Properties of this implementation rather than of the parsing model.

  test("the input is never mutated", () => {
    const tokens = fc.array(fc.constantFrom("a", "b", "1", "2"), { maxLength: 6 });

    fc.assert(
      fc.property(tokens, (input) => {
        const before = [...input];
        parse(word("a").repeat(token()), input);
        expect(input).toEqual(before);
      }),
    );
  });

  test("running a spec twice gives identical results", () => {
    const spec = repeat(word("a")).token();
    const tokens = fc.array(fc.constantFrom("a", "b"), { maxLength: 5 });

    fc.assert(
      fc.property(tokens, (input) => {
        expect([...spec.run(input)]).toEqual([...spec.run(input)]);
      }),
    );
  });
});
