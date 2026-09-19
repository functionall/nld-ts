import { describe, expect, test } from "vitest";
import {
  autocomplete,
  best,
  boolean,
  choice,
  concat,
  Core,
  empty,
  float,
  grammar,
  ignore,
  indexedBoolean,
  indexedFloat,
  indexedInt,
  indexedMinimalToken,
  indexedNat,
  indexedToken,
  indexedTokenMatching,
  indexedTokenOfType,
  indexedWord,
  indexedWords,
  int,
  map,
  minimalToken,
  nat,
  Nld,
  optional,
  parse,
  phrase,
  reduce,
  repeat,
  replace,
  run,
  Spec,
  suggest,
  tag,
  token,
  tokenize,
  tokenMatching,
  tokenOfType,
  unwrapAndTag,
  wanted,
  word,
  words,
  wrap,
} from "../src/index.js";

const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);

describe("module doc example", () => {
  const cancel = ignore(words(["cancel", "stop", "halt"]))
    .ignore(word("order"))
    .optional(nat())
    .tag("cancel_order");

  const status = ignore(word("order")).ignore(word("status")).optional(nat()).tag("order_status");
  const intents = choice([cancel, status]);

  test("parse, best and suggest", () => {
    expect(parse(intents, "Please cancel my order 42")).toEqual([
      [{ tag: "cancel_order", value: [42] }],
      [{ tag: "cancel_order", value: [] }],
    ]);

    expect(best(intents, "order status")).toEqual([{ tag: "order_status", value: [] }]);

    expect(suggest(intents, "canc")).toEqual([
      ["cancel", "halt", "order", "stop"],
      ["cancel", "halt", "order", "stop"],
    ]);
  });

  test("README examples", () => {
    expect(best(intents, "Please cancel my order 42")).toEqual([{ tag: "cancel_order", value: [42] }]);
    expect(best(intents, "stop the order, number 42")).toEqual([{ tag: "cancel_order", value: [42] }]);
    expect(best(intents, "what's the status of order 7")).toEqual([{ tag: "order_status", value: [7] }]);
    expect(best(intents, "tell me a joke")).toBeNull();
    expect(suggest(cancel, "cancel")).toEqual([["order"]]);
  });
});

describe("string input", () => {
  test("tokenizes and downcases by default", () => {
    expect(parse(word("set").nat(), "Set the value to 42")).toEqual([["set", 42]]);
    expect(parse(word("set").nat(), "Set the value to 42", { downcase: false })).toEqual([]);
  });

  test("token lists are exact", () => {
    expect(parse(word("Set"), ["Set"])).toEqual([["Set"]]);
    expect(parse(word("set"), ["Set"])).toEqual([]);
  });

  test("custom tokenizer", () => {
    const tokenizer = (text: string) => text.split(/\s+/);
    expect(parse(word("a-b"), "a-b c", { tokenizer })).toEqual([["a-b"]]);
  });

  test("a custom tokenizer's tokens are downcased too", () => {
    const tokenizer = (text: string) => text.split(/\s+/);
    expect(parse(word("a-b"), "A-B c", { tokenizer })).toEqual([["a-b"]]);
    expect(parse(word("a-b"), "A-B c", { tokenizer, downcase: false })).toEqual([]);
  });

  test("undefined options mean the defaults", () => {
    const opts = { downcase: undefined, tokenizer: undefined, limit: undefined };
    expect(parse(word("set"), "Set", opts)).toEqual([["set"]]);
  });
});

describe("result shaping", () => {
  test("leaves accumulate into a list", () => {
    expect(parse(word("a").word("b").nat(), "a b 3")).toEqual([["a", "b", 3]]);
  });

  test("ignore, tag, unwrapAndTag, wrap, reduce, map, replace", () => {
    const spec = ignore(word("set")).nat().unwrapAndTag("value");
    expect(parse(spec, "set 42")).toEqual([[{ tag: "value", value: 42 }]]);
    expect(parse(word("a").word("b").tag("ab"), "a b")).toEqual([[{ tag: "ab", value: ["a", "b"] }]]);
    expect(parse(wrap(word("a").word("b")).word("c"), "a b c")).toEqual([[["a", "b"], "c"]]);
    expect(parse(ignore(word("sum")).repeat(nat()).reduce(sum), "sum 1 2", { limit: 1 })).toEqual([[3]]);
    expect(parse(repeat(nat()).map((n) => n * 2), "1 2", { limit: 1 })).toEqual([[2, 4]]);
    expect(parse(words(["yes", "yeah"]).replace(true), "yeah")).toEqual([[true]]);
    expect(parse(ignore(word("a")), "a")).toEqual([[]]);
  });

  test("the function forms shape a whole spec", () => {
    expect(parse(tag(word("set").nat(), "set"), "set 42")).toEqual([
      [{ tag: "set", value: ["set", 42] }],
    ]);

    expect(parse(unwrapAndTag(nat(), "n"), "42")).toEqual([[{ tag: "n", value: 42 }]]);
    expect(parse(reduce(repeat(nat()), sum), "1 2", { limit: 1 })).toEqual([[3]]);
    expect(parse(map(repeat(nat()), (n) => n * 10), "1 2", { limit: 1 })).toEqual([[10, 20]]);
    expect(parse(replace(words(["yes", "yeah", "yep"]), true), "yeah")).toEqual([[true]]);
    expect(parse(optional(nat()), "order")).toEqual([[]]);
  });

  test("unwrapAndTag throws when the spec yields more than one result", () => {
    expect(() => parse(word("set").nat().unwrapAndTag("set"), "set 42")).toThrow(
      /unwrapAndTag\("set"\) expects exactly one result, got: \["set",42\]/,
    );

    expect(() => parse(ignore(word("set")).unwrapAndTag("set"), "set")).toThrow(
      /expects exactly one result, got: \[\]/,
    );
  });

  test("two-argument builders shape only their argument", () => {
    expect(parse(word("a").tag(word("b"), "b").word("c"), "a b c")).toEqual([
      ["a", { tag: "b", value: ["b"] }, "c"],
    ]);

    expect(parse(word("a").unwrapAndTag(nat(), "n"), "a 1")).toEqual([["a", { tag: "n", value: 1 }]]);
    expect(parse(word("a").reduce(repeat(nat()), sum), "a 1 2", { limit: 1 })).toEqual([["a", 3]]);
    expect(parse(word("a").map(repeat(nat()), (n) => -n), "a 1 2", { limit: 1 })).toEqual([["a", -1, -2]]);
    expect(parse(word("a").replace(word("b"), 0), "a b")).toEqual([["a", 0]]);
    expect(parse(word("a").wrap(word("b").word("c")), "a b c")).toEqual([["a", ["b", "c"]]]);
  });

  test("tags can be any value", () => {
    const secret = Symbol("secret");
    expect(parse(word("a").tag(1), "a")).toEqual([[{ tag: 1, value: ["a"] }]]);
    expect(parse(word("a").tag(secret), "a")).toEqual([[{ tag: secret, value: ["a"] }]]);
  });

  test("specs are immutable: extending one leaves it unchanged", () => {
    const base = word("a");
    const longer = base.word("b");
    expect(parse(base, "a b")).toEqual([["a"]]);
    expect(parse(longer, "a b")).toEqual([["a", "b"]]);
  });
});

describe("leaves", () => {
  test("every leaf exists as a function and as a method", () => {
    const even = (t: string) => (/^[0-9]+$/.test(t) && Number(t) % 2 === 0 ? Number(t) : undefined);
    const upper = (t: string) => t === t.toUpperCase();

    expect(parse(minimalToken([[0, "buy"], [1, "get"]]), "get")).toEqual([["get"]]);
    expect(parse(phrase(["set", "volume"]), "set the volume")).toEqual([["set volume"]]);
    expect(parse(token(), "x")).toEqual([["x"]]);
    expect(parse(tokenMatching(upper), ["a", "B"])).toEqual([["B"]]);
    expect(parse(tokenOfType("nat", even), "3 4")).toEqual([[4]]);
    expect(parse(int(), ["-3"])).toEqual([[-3]]);
    expect(parse(float(), ["2.5"])).toEqual([[2.5]]);
    expect(parse(boolean(), "TRUE")).toEqual([[true]]);

    expect(parse(indexedWord("b"), "a b")).toEqual([[["b", 1]]]);
    expect(parse(indexedWords(["hello", "hi"]), "oh hi")).toEqual([[["hello", 1]]]);
    expect(parse(indexedMinimalToken([[0, "buy"]]), "to buy")).toEqual([[["buy", 1]]]);
    expect(parse(indexedToken(), "x")).toEqual([[["x", 0]]]);
    expect(parse(indexedTokenMatching(upper), ["a", "B"])).toEqual([[["B", 1]]]);
    expect(parse(indexedTokenOfType("nat", even), "3 4")).toEqual([[[4, 1]]]);
    expect(parse(indexedNat(), "a 7")).toEqual([[[7, 1]]]);
    expect(parse(indexedInt(), ["a", "-7"])).toEqual([[[-7, 1]]]);
    expect(parse(indexedFloat(), ["a", "7.5"])).toEqual([[[7.5, 1]]]);
    expect(parse(indexedBoolean(), "a false")).toEqual([[[false, 1]]]);

    const chained = word("go")
      .words(["north", "up"])
      .minimalToken([[0, "fast"]])
      .phrase(["right", "now"])
      .nat()
      .int()
      .float()
      .boolean()
      .tokenOfType("nat", even)
      .tokenMatching((t) => t === "!")
      .token();

    expect(parse(chained, "go up fast right now 1 2 3 true 4 ! please", { limit: 1 })).toEqual([
      ["go", "north", "fast", "right now", 1, 2, 3, true, 4, "!", "please"],
    ]);

    const indexed = indexedWord("a")
      .indexedWords(["b", "bee"])
      .indexedMinimalToken([[0, "c"]])
      .indexedNat()
      .indexedInt()
      .indexedFloat()
      .indexedBoolean()
      .indexedTokenOfType("nat", even)
      .indexedTokenMatching((t) => t === "!")
      .indexedToken();

    expect(parse(indexed, "a bee c 1 2 3 false 4 ! z", { limit: 1 })).toEqual([
      [["a", 0], ["b", 1], ["c", 2], [1, 3], [2, 4], [3, 5], [false, 6], [4, 7], ["!", 8], ["z", 9]],
    ]);
  });
});

describe("combinators", () => {
  test("choice yields each alternative's list", () => {
    expect(parse(choice([word("cat"), word("dog")]), "cat dog")).toEqual([["cat"], ["dog"]]);
    expect(parse(word("a").choice([word("cat"), word("dog")]), "a dog")).toEqual([["a", "dog"]]);
  });

  test("repeat flattens iterations", () => {
    expect(parse(repeat(word("a").word("b")), "a b a b", { limit: 1 })).toEqual([["a", "b", "a", "b"]]);

    expect(parse(ignore(word("add")).repeat(nat()), "add 1 and 2 and 3")).toEqual([
      [1, 2, 3],
      [1, 2],
      [1],
      [],
    ]);
  });

  test("repeat flattens one level only", () => {
    expect(parse(repeat(wrap(word("a").nat())), "a 1 a 2", { limit: 1 })).toEqual([
      [["a", 1], ["a", 2]],
    ]);
  });

  test("optional prefers the consuming parse and restores state when skipping", () => {
    const spec = ignore(word("order")).optional(nat()).word("please");
    expect(parse(spec, "order 42 please")).toEqual([[42, "please"], ["please"]]);
    expect(parse(ignore(word("order")).optional(nat()), "order 42")).toEqual([[42], []]);
    expect(parse(ignore(word("order")).optional(nat()), "order")).toEqual([[]]);
    expect(parse(optional(nat()).word("x"), "5 x")).toEqual([[5, "x"], ["x"]]);
  });

  test("ignore accepts any parser, including bare Core ones", () => {
    expect(parse(ignore(Core.word("set")).nat(), "set the value to 42")).toEqual([[42]]);
  });

  test("grammar and wanted match the equivalent Core spec", () => {
    const nat_ = { tag: "token", value: { tag: "nat" } };

    expect(grammar(ignore(word("a")).word("b"))).toEqual(
      Core.grammar(Core.tuple2(Core.word("a"), Core.word("b"))),
    );

    expect(grammar(word("a").tag("x"))).toEqual({ tag: "literal", value: "a" });
    expect(grammar(optional(nat()))).toEqual({ tag: "choice", value: [nat_, { tag: "seq", value: [] }] });
    expect(wanted(word("a").word("b"))).toEqual(new Set(["a"]));

    expect(wanted(choice([words(["cancel", "stop"]), word("status")]))).toEqual(
      new Set(["cancel", "stop", "status"]),
    );
  });

  test("empty and concat", () => {
    expect(parse(empty(), "anything")).toEqual([[]]);
    expect(parse(empty().word("a"), "a")).toEqual([["a"]]);
    expect(parse(concat(word("a"), nat()), "a 1")).toEqual([["a", 1]]);
    expect(parse(word("a").concat(nat()), "a 1")).toEqual([["a", 1]]);
  });

  test("Spec.from makes a Core parser that yields a list chainable", () => {
    const a = word("a");
    expect(Spec.from(a)).toBe(a);

    const pairOfNats = Core.map2(Core.nat(), Core.nat(), (a, b) => [a, b]);
    const spec = Spec.from(pairOfNats);
    expect(spec).toBeInstanceOf(Spec);
    expect(parse(spec.word("x"), "1 2 x")).toEqual([[1, 2, "x"], [2, 1, "x"]]);
  });
});

describe("runners", () => {
  test("run yields weights", () => {
    expect([...run(word("a").word("b"), "a b")]).toEqual([[1, ["a", "b"]]]);
    expect([...run(word("set").nat(), "set the value to 42")]).toEqual([[4, ["set", 42]]]);
  });

  test("parse honours limit", () => {
    expect(parse(word("cat"), ["cat", "dog", "cat"], { limit: 1 })).toEqual([["cat"]]);
    expect(parse(word("cat"), ["cat", "dog", "cat"], { limit: 0 })).toEqual([]);
    expect(parse(word("cat"), ["cat", "dog", "cat"])).toEqual([["cat"], ["cat"]]);
  });

  test("best returns null without a parse", () => {
    expect(best(word("cat"), "dog")).toBeNull();
    expect(best(word("cat"), "the cat")).toEqual(["cat"]);
    expect(best(word("cat"), "the cat sat")).toEqual(["cat"]);
  });

  test("suggest mirrors Core.topK and honours limit", () => {
    const spec = choice([word("cat"), word("dog")]);
    expect(suggest(spec, "")).toEqual(Core.topK(spec, [], 5));
    expect(suggest(spec, "", { limit: 1 })).toEqual([["cat", "dog"]]);
    expect([...autocomplete(word("cat"), "")]).toEqual([[0, ["cat"]]]);

    const buy = word("buy").word("apples");
    expect(suggest(buy, "")).toEqual([["buy"]]);
    expect(suggest(buy, "buy")).toEqual([["apples"]]);
    expect(suggest(buy, "buy apples")).toEqual([]);
  });

  test("the runners exist as methods too", () => {
    const spec = ignore(word("order")).optional(nat());
    expect(spec.parse("order 42")).toEqual(parse(spec, "order 42"));
    expect(spec.parse("order 42", { limit: 1 })).toEqual([[42]]);
    expect(spec.best("order 42")).toEqual([42]);
    expect(spec.best("nothing")).toBeNull();
    expect([...spec.run("order 42")]).toEqual([...run(spec, "order 42")]);
    expect(spec.suggest("")).toEqual([["order"]]);
    expect([...spec.autocomplete("")]).toEqual([[0, ["order"]]]);
    expect(spec.grammar()).toEqual(grammar(spec));
    expect(spec.wanted()).toEqual(new Set(["order"]));
  });

  test("Core parsers run through the same runners", () => {
    expect(parse(Core.tuple2(Core.word("buy"), Core.nat()), "Buy 3 apples")).toEqual([["buy", 3]]);
    expect(best(Core.nat(), "no numbers")).toBeNull();
  });

  test("tokenize is exported", () => {
    expect(tokenize("setHTMLParser")).toEqual(["set", "HTML", "Parser"]);
  });
});

describe("toString shows the grammar", () => {
  test("as `#Nld<...>`", () => {
    expect(String(word("set").nat())).toBe('#Nld<seq [literal "set", token nat]>');

    expect(String(choice([words(["a", "b"]), repeat(token())]))).toBe(
      '#Nld<choice [minimalToken [0 "a", 1 "b"], repeat (anyToken)]>',
    );

    expect(`${Core.pure(1)}`).toBe("#Nld<seq []>");
  });

  test("a spec is an Nld", () => {
    expect(word("a")).toBeInstanceOf(Nld);
    expect(word("a")).toBeInstanceOf(Spec);
  });
});
