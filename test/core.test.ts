import { describe, expect, test } from "vitest";
import { Core, type Grammar, tokenize } from "../src/index.js";

const {
  autocomplete,
  boolean,
  choice,
  float,
  grammar,
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
  map2,
  map3,
  minimalToken,
  nat,
  optional,
  phrase,
  pure,
  repeat,
  run,
  runList,
  runTake,
  sequence,
  token,
  tokenMatching,
  tokenOfType,
  topK,
  tuple2,
  tuple3,
  wanted,
  weight,
  word,
  words,
} = Core;

/** Splits a sentence into words. */
const w = (text: string): string[] => text.split(" ").filter((t) => t !== "");
const pair = <A, B>(a: A, b: B): [A, B] => [a, b];
const lit = (value: string): Grammar => ({ tag: "literal", value });
const startsWith = (prefix: string) => (t: string) => t.startsWith(prefix);

describe("doc examples", () => {
  test("pure", () => {
    expect(runList(pure(42), ["any", "tokens"])).toEqual([42]);
    expect(runList(pure("hello"), [])).toEqual(["hello"]);
  });

  test("indexedWord", () => {
    expect(runList(indexedWord("cat"), w("the cat sat"))).toEqual([["cat", 1]]);
    expect(runList(indexedWord("the"), w("the cat saw the dog"))).toEqual([["the", 0], ["the", 3]]);
  });

  test("indexedMinimalToken", () => {
    expect(runList(indexedMinimalToken([[0, "buy"], [1, "get"]]), w("get buy"))).toEqual([
      ["buy", 1],
      ["get", 0],
    ]);
  });

  test("indexedWords", () => {
    expect(runList(indexedWords(["hello", "hi", "hey"]), w("hey there"))).toEqual([["hello", 0]]);
    expect(runList(indexedWords([]), w("hey there"))).toEqual([]);
  });

  test("indexedTokenMatching", () => {
    expect(runList(indexedTokenMatching(startsWith("a")), w("the apple and"))).toEqual([
      ["apple", 1],
      ["and", 2],
    ]);
  });

  test("indexedTokenOfType", () => {
    const hex = indexedTokenOfType("nat", (t) =>
      /^[0-9a-f]+$/i.test(t) ? Number.parseInt(t, 16) : undefined,
    );

    expect(runList(hex, ["value", "ff"])).toEqual([[255, 1]]);
  });

  test("a token parser may yield falsy values; only undefined rejects", () => {
    const zeroOrEmpty = tokenOfType("nat", (t) => (t === "zero" ? 0 : t === "empty" ? "" : undefined));
    expect(runList(zeroOrEmpty, w("x zero empty"))).toEqual([0, ""]);

    const nothing = tokenOfType("nat", (t) => (t === "null" ? null : undefined));
    expect(runList(nothing, w("x null"))).toEqual([null]);
  });

  test("indexedNat, indexedInt, indexedFloat", () => {
    expect(runList(indexedNat(), w("buy 42 apples"))).toEqual([[42, 1]]);
    expect(runList(indexedInt(), w("sell -3 items"))).toEqual([[-3, 1]]);
    expect(runList(indexedFloat(), w("set rate 3.14"))).toEqual([[3.14, 2]]);
  });

  test("word", () => {
    expect(runList(word("cat"), w("the cat sat"))).toEqual(["cat"]);
    expect(runList(word("dog"), w("the cat sat"))).toEqual([]);
    expect(runList(word("cat"), w("cat dog cat"))).toEqual(["cat", "cat"]);
  });

  test("words", () => {
    expect(runTake(tuple2(words(["hello", "hi"]), token()), w("hi world"), 1)).toEqual([
      ["hello", "world"],
    ]);
  });

  test("minimalToken", () => {
    const buy = minimalToken([[0, "buy"], [0, "purchase"], [1, "get"]]);
    expect(runTake(buy, w("get buy"), 1)).toEqual(["buy"]);
    expect(runList(minimalToken([[0, "yes"], [0, "no"]]), ["yes"])).toEqual(["yes"]);
  });

  test("token", () => {
    expect(runList(token(), ["hello"])).toEqual(["hello"]);
    expect(runList(token(), w("a b c"))).toEqual(["a", "b", "c"]);
    expect(runList(indexedToken(), w("a b"))).toEqual([["a", 0], ["b", 1]]);
  });

  test("tokenMatching", () => {
    expect(runList(tokenMatching(startsWith("a")), w("apple banana avocado"))).toEqual([
      "apple",
      "avocado",
    ]);

    expect(runList(tokenMatching(startsWith("z")), w("apple banana"))).toEqual([]);
  });

  test("nat, int, float, boolean", () => {
    expect(runList(nat(), ["42"])).toEqual([42]);
    expect(runList(nat(), w("buy 5 apples"))).toEqual([5]);
    expect(runList(nat(), w("hello world"))).toEqual([]);
    expect(runList(int(), w("set offset to -3"))).toEqual([-3]);
    expect(runList(float(), w("set rate to 2.5"))).toEqual([2.5]);
    expect(runList(boolean(), w("set verbose True"))).toEqual([true]);
  });

  test("map", () => {
    expect(runList(map(word("hello"), (s) => s.toUpperCase()), ["hello"])).toEqual(["HELLO"]);
    expect(runList(map(nat(), (n) => n * 2), ["5"])).toEqual([10]);
  });

  test("map2", () => {
    expect(runList(map2(word("red"), word("ball"), pair), w("red ball"))).toEqual([["red", "ball"]]);
    expect(runList(map2(word("red"), word("ball"), pair), w("ball red"))).toEqual([["red", "ball"]]);
    expect(runList(map2(word("a"), word("a"), pair), w("a a"))).toEqual([["a", "a"], ["a", "a"]]);
  });

  test("map3", () => {
    const spec = map3(word("set"), token(), nat(), (verb, name, n) => `${verb}:${name}=${n}`);
    expect(runList(spec, w("set x 42"))).toEqual(["set:x=42"]);
  });

  test("tuple2 and tuple3", () => {
    expect(runList(tuple2(word("name"), token()), w("name Alice"))).toEqual([["name", "Alice"]]);
    expect(runList(tuple2(word("set"), nat()), w("can you set the value to 42"))).toEqual([["set", 42]]);
    expect(runList(tuple3(word("set"), token(), nat()), w("set x 42"))).toEqual([["set", "x", 42]]);

    expect(runList(tuple3(word("move"), token(), word("to")), w("to backup move"))).toEqual([
      ["move", "backup", "to"],
    ]);
  });

  test("sequence", () => {
    expect(runList(sequence([word("a"), word("b")]), w("a b"))).toEqual([["a", "b"]]);

    const removeFile = sequence([words(w("remove delete erase")), words(w("file document"))]);
    expect(runList(removeFile, w("please erase the document"))).toEqual([["remove", "file"]]);
    expect(runList(sequence([]), ["hello"])).toEqual([[]]);
  });

  test("phrase", () => {
    expect(runList(phrase(w("delete file")), w("please delete the file"))).toEqual(["delete file"]);

    expect(runList(tuple2(phrase(w("set volume")), nat()), w("set the volume to 11"))).toEqual([
      ["set volume", 11],
    ]);

    expect(runList(phrase([]), ["hello"])).toEqual([""]);
  });

  test("choice", () => {
    expect(runList(choice([word("yes"), word("yeah"), word("yep")]), ["yeah"])).toEqual(["yeah"]);
    expect(runList(choice([word("cat"), word("dog")]), w("cat dog"))).toEqual(["cat", "dog"]);
    expect(runList(choice([word("cat"), word("dog")]), ["bird"])).toEqual([]);
    expect(runList(choice([]), ["bird"])).toEqual([]);
  });

  test("choice of one is that parser", () => {
    const cat = word("cat");
    expect(choice([cat])).toBe(cat);
  });

  test("repeat", () => {
    expect(runList(repeat(word("cat")), w("cat cat"))).toEqual([["cat", "cat"], ["cat"], []]);
    expect(runList(repeat(nat()), w("a 1 b 2 c 3"))).toEqual([[1, 2, 3], [1, 2], [1], []]);
    expect(runTake(repeat(word("cat")), ["dog"], 1)).toEqual([[]]);
  });

  test("optional", () => {
    expect(runList(optional(nat()), w("set 42"))).toEqual([[42], []]);
    expect(runList(optional(nat()), ["set"])).toEqual([[]]);
  });

  test("weight", () => {
    expect(runList(choice([weight(word("a"), 5), word("b")]), w("a b"))).toEqual(["b", "a"]);
    expect([...run(weight(word("a"), 2.5), w("x a"))]).toEqual([[3.5, "a"]]);
  });

  test("grammar", () => {
    expect(grammar(word("hello"))).toEqual(lit("hello"));

    expect(grammar(tuple2(word("buy"), nat()))).toEqual({
      tag: "seq",
      value: [lit("buy"), { tag: "token", value: { tag: "nat" } }],
    });

    expect(grammar(choice([word("yes"), word("no")]))).toEqual({
      tag: "choice",
      value: [lit("yes"), lit("no")],
    });
  });

  test("wanted", () => {
    expect(wanted(word("hello"))).toEqual(new Set(["hello"]));
    expect(wanted(map2(word("a"), word("b"), pair))).toEqual(new Set(["a"]));
  });

  test("run", () => {
    expect([...run(word("cat"), ["cat"])]).toEqual([[0, "cat"]]);

    expect([...run(tuple2(indexedWord("the"), word("cat")), w("the cat saw the dog"))]).toEqual([
      [1, [["the", 0], "cat"]],
      [7.5, [["the", 3], "cat"]],
    ]);
  });

  test("runList", () => {
    expect(runList(word("cat"), w("the cat"))).toEqual(["cat"]);

    expect(runList(tuple2(word("hello"), token()), w("world says hello"))).toEqual([
      ["hello", "says"],
      ["hello", "world"],
    ]);
  });

  test("runTake", () => {
    expect(runTake(word("cat"), w("cat cat cat"), 1)).toEqual(["cat"]);
    expect(runTake(map2(word("a"), word("b"), pair), w("a b a b"), 2)).toEqual([["a", "b"], ["a", "b"]]);
    expect(runTake(word("cat"), w("cat cat cat"), 0)).toEqual([]);
  });

  test("autocomplete", () => {
    expect([...autocomplete(word("cat"), [])]).toEqual([[0, ["cat"]]]);
    expect([...autocomplete(word("cat"), ["cat"])]).toEqual([]);
    expect([...autocomplete(map2(word("buy"), word("apples"), pair), ["buy"])]).toEqual([
      [0, ["apples"]],
    ]);
  });

  test("topK", () => {
    expect(topK(word("cat"), [], 5)).toEqual([["cat"]]);
    expect(topK(word("cat"), ["cat"], 5)).toEqual([]);
    expect(topK(map2(word("buy"), word("apples"), pair), ["buy"], 5)).toEqual([["apples"]]);
    expect(topK(choice([word("cat"), word("dog")]), [], 5)).toEqual([["cat", "dog"], ["cat", "dog"]]);
  });
});

describe("README: ignoring irrelevant tokens", () => {
  test("word skips fillers", () => {
    expect(runList(word("delete"), w("please delete this file"))).toEqual(["delete"]);
  });

  test("tuple2 with nat skips fillers", () => {
    expect(runList(tuple2(word("set"), nat()), w("can you set the value to 42"))).toEqual([["set", 42]]);
  });
});

describe("README: flexible word order", () => {
  test("any order parses", () => {
    const deleteFile = tuple2(word("delete"), word("file"));
    expect(runList(deleteFile, w("delete file"))).toEqual([["delete", "file"]]);
    expect(runList(deleteFile, w("file delete"))).toEqual([["delete", "file"]]);
    expect(runList(deleteFile, w("the file should be delete"))).toEqual([["delete", "file"]]);
  });

  test("three required tokens in scrambled order", () => {
    expect(runList(tuple3(word("move"), token(), word("to")), w("to backup move"))).toEqual([
      ["move", "backup", "to"],
    ]);
  });
});

describe("README: capturing tokens", () => {
  test("token anywhere relative to keywords, closest first", () => {
    expect(runList(tuple2(word("hello"), token()), w("hello world"))).toEqual([["hello", "world"]]);

    expect(runList(tuple2(word("hello"), token()), w("world says hello"))).toEqual([
      ["hello", "says"],
      ["hello", "world"],
    ]);
  });

  test("nat anywhere", () => {
    expect(runList(tuple2(word("buy"), nat()), w("I want to buy 3 apples"))).toEqual([["buy", 3]]);
    expect(runList(tuple2(word("buy"), nat()), w("3 buy"))).toEqual([["buy", 3]]);
  });

  test("tokenMatching with a predicate", () => {
    const open = tuple2(word("open"), tokenMatching((t) => t.endsWith(".txt")));
    expect(runList(open, w("please open report.txt"))).toEqual([["open", "report.txt"]]);
  });

  test("indexedWord returns the position", () => {
    expect(runList(indexedWord("cat"), w("the cat sat"))).toEqual([["cat", 1]]);
  });
});

describe("README: alternatives", () => {
  test("choice with mapped synonyms", () => {
    const deletes = map(words(w("delete remove erase")), (v) => ["left", v] as const);
    const adds = map(words(w("add update modify")), (v) => ["right", v] as const);

    expect(runList(tuple2(choice([deletes, adds]), token()), w("Please erase everything"))).toEqual([
      [["left", "delete"], "everything"],
      [["left", "delete"], "Please"],
    ]);
  });

  test("minimalToken tie is resolved first-in-first-out", () => {
    expect(runTake(minimalToken([[0, "delete"], [1, "remove"]]), w("remove delete"), 1)).toEqual([
      "delete",
    ]);
  });
});

describe("README: repetition and priority", () => {
  test("repeat collects scattered occurrences, longest first", () => {
    expect(runList(tuple2(word("add"), repeat(nat())), w("add 1 and 2 and 3"))).toEqual([
      ["add", [1, 2, 3]],
      ["add", [1, 2]],
      ["add", [1]],
      ["add", []],
    ]);
  });

  test("closer tokens are preferred and all parses are returned", () => {
    expect(runTake(tuple2(indexedWord("the"), word("cat")), w("the cat saw the dog"), 2)).toEqual([
      [["the", 0], "cat"],
      [["the", 3], "cat"],
    ]);
  });

  test("tokenize feeds the runners", () => {
    expect(runList(tuple2(word("buy"), nat()), tokenize("buy 3 apples"))).toEqual([["buy", 3]]);
  });
});

describe("upstream test groups", () => {
  test("nondeterminism counts", () => {
    expect(runList(map2(word("a"), word("b"), pair), w("a b a b"))).toHaveLength(4);
    expect(runList(map2(word("the"), word("fox"), pair), w("the fox the fox"))).toHaveLength(4);
    expect(runList(word("cat"), w("cat dog cat"))).toHaveLength(2);
    expect(runList(token(), w("a b c"))).toHaveLength(3);
    expect(runList(tokenMatching(startsWith("a")), w("apple banana avocado"))).toHaveLength(2);
  });

  test("choice returns results from each matching alternative", () => {
    const results = runList(choice([word("cat"), word("dog")]), w("cat dog"));
    expect(results).toHaveLength(2);
    expect(results).toContain("cat");
    expect(results).toContain("dog");
  });

  test("map2 skips fillers in either position", () => {
    const redBall = map2(word("red"), word("ball"), pair);
    expect(runList(redBall, w("the red ball"))).toEqual([["red", "ball"]]);
    expect(runList(redBall, w("red big ball"))).toEqual([["red", "ball"]]);
  });

  test("wordAndNat: nat before or after the keywords", () => {
    const buyApples = map2(nat(), map2(word("buy"), word("apples"), pair), (n) => n);
    expect(runList(buyApples, w("buy 5 apples"))).toEqual([5]);
    expect(runList(buyApples, w("apples buy 10"))).toEqual([10]);
  });

  test("sequence and phrase", () => {
    expect(runList(sequence([word("set"), word("volume")]), w("set the volume"))).toEqual([
      ["set", "volume"],
    ]);

    expect(runList(sequence([]), w("hello"))).toEqual([[]]);
    expect(runList(phrase(w("delete file")), w("delete file"))).toEqual(["delete file"]);
    expect(runList(phrase(w("hello")), w("hello world"))).toEqual(["hello"]);
    expect(runList(phrase([]), w("hello"))).toEqual([""]);
  });

  test("int, float and boolean", () => {
    expect(runList(int(), ["-7"])).toEqual([-7]);
    expect(runList(int(), ["42"])).toEqual([42]);
    expect(runList(int(), w("set offset to -3"))).toEqual([-3]);
    expect(runList(int(), w("hello world"))).toEqual([]);
    expect(runList(float(), ["3.14"])).toEqual([3.14]);
    expect(runList(float(), w("set rate to 2.5"))).toEqual([2.5]);
    expect(runList(float(), w("hello world"))).toEqual([]);
    expect(runList(boolean(), ["true"])).toEqual([true]);
    expect(runList(boolean(), ["FALSE"])).toEqual([false]);
    expect(runList(boolean(), ["True"])).toEqual([true]);
    expect(runList(boolean(), w("hello world"))).toEqual([]);
  });

  test("indexed variants", () => {
    expect(runList(indexedWords(w("hello hi")), w("hi there"))).toEqual([["hello", 0]]);
    expect(runList(indexedNat(), w("buy 42 apples"))).toEqual([[42, 1]]);
    expect(runList(indexedTokenMatching(startsWith("a")), w("the apple"))).toEqual([["apple", 1]]);
    expect(runList(indexedBoolean(), w("set flag false"))).toEqual([[false, 2]]);
  });

  test("repeat basics", () => {
    const cats = repeat(word("cat"));
    expect(runList(cats, w("dog"))).toContainEqual([]);
    expect(runList(cats, w("cat cat"))).toContainEqual(["cat", "cat"]);
    expect(runList(repeat(nat()), w("1 2 3")).some((r) => r.length === 3)).toBe(true);
  });

  test("pure ignores the input", () => {
    expect(runList(pure(42), w("ignored tokens"))).toEqual([42]);
    expect(runList(pure("hello"), [])).toEqual(["hello"]);
  });
});

describe("number tokens", () => {
  test("nat accepts ASCII digits only", () => {
    expect(runList(nat(), ["007"])).toEqual([7]);
    expect(runList(nat(), ["-7"])).toEqual([]);
    expect(runList(nat(), ["+7"])).toEqual([]);
    expect(runList(nat(), ["1.0"])).toEqual([]);
    expect(runList(nat(), ["1e3"])).toEqual([]);
    expect(runList(nat(), [""])).toEqual([]);
    expect(runList(nat(), [String.fromCodePoint(0x661, 0x662)])).toEqual([]);
  });

  test("int accepts an optional sign and never yields negative zero", () => {
    expect(runList(int(), ["+5"])).toEqual([5]);
    expect(runList(int(), ["-0"])).toEqual([0]);
    expect(Object.is(runList(int(), ["-0"])[0], 0)).toBe(true);
    expect(runList(int(), ["1.5"])).toEqual([]);
    expect(runList(int(), ["0x10"])).toEqual([]);
    expect(runList(int(), ["-"])).toEqual([]);
  });

  test("float needs digits on both sides of the point and accepts exponents", () => {
    expect(runList(float(), ["42"])).toEqual([42]);
    expect(runList(float(), ["1e5"])).toEqual([100000]);
    expect(runList(float(), ["1E5"])).toEqual([100000]);
    expect(runList(float(), ["1.5e-3"])).toEqual([0.0015]);
    expect(runList(float(), ["+3.5"])).toEqual([3.5]);
    expect(runList(float(), ["-3.5"])).toEqual([-3.5]);
    expect(Object.is(runList(float(), ["-0"])[0], -0)).toBe(true);
    expect(runList(float(), [".5"])).toEqual([]);
    expect(runList(float(), ["1."])).toEqual([]);
    expect(runList(float(), ["1.e5"])).toEqual([]);
    expect(runList(float(), ["1e"])).toEqual([]);
    expect(runList(float(), ["1e999"])).toEqual([]);
    expect(runList(float(), ["Infinity"])).toEqual([]);
    expect(runList(float(), ["NaN"])).toEqual([]);
    expect(runList(float(), ["0x10"])).toEqual([]);
    expect(runList(float(), [" 1"])).toEqual([]);
  });

  test("integers that a double cannot hold exactly do not match", () => {
    expect(runList(nat(), ["9007199254740991"])).toEqual([9007199254740991]);
    expect(runList(nat(), ["9007199254740993"])).toEqual([]);
    expect(runList(int(), ["-9007199254740993"])).toEqual([]);

    const big = tokenOfType("nat", (t) => (/^[0-9]+$/.test(t) ? BigInt(t) : undefined));
    expect(runList(big, ["9007199254740993"])).toEqual([9007199254740993n]);
  });
});

describe("weights", () => {
  test("run yields total weights", () => {
    expect([...run(tuple2(word("delete"), word("file")), w("the file should be delete"))]).toEqual([
      [10, ["delete", "file"]],
    ]);
  });

  test("results are deterministic", () => {
    const parser = map2(word("a"), word("b"), pair);
    expect(runList(parser, w("a b a c"))).toEqual(runList(parser, w("a b a c")));
  });

  test("a parser can be run any number of times", () => {
    const parser = tuple2(word("a"), repeat(nat()));
    const first = [...run(parser, w("a 1 2"))];
    expect([...run(parser, w("a 1 2"))]).toEqual(first);
    expect(runList(parser, w("a 9"))).toEqual([["a", [9]], ["a", []]]);
  });

  test("run is lazy: the first result does not explore the whole space", () => {
    const parser = tuple2(token(), token());
    const tokens = Array.from({ length: 40 }, (_, i) => String(i + 1));
    expect(runTake(map(parser, (v) => v), tokens, 1)).toEqual([["1", "2"]]);

    const results = run(parser, tokens);
    expect(results.next().value).toEqual([1, ["1", "2"]]);
  });

  test("run stops computing once the consumer stops asking", () => {
    let calls = 0;

    const counting = tokenMatching(() => {
      calls++;
      return true;
    });

    const tokens = Array.from({ length: 200 }, (_, i) => String(i));
    expect(runTake(counting, tokens, 3)).toEqual(["0", "1", "2"]);
    expect(calls).toBeLessThan(10);
  });
});

describe("autocomplete", () => {
  test("reports missing tokens and nothing on success", () => {
    const buyApples = map2(word("buy"), word("apples"), pair);
    expect(topK(buyApples, [], 5)).toEqual([["buy"]]);
    expect(topK(buyApples, w("buy"), 5)).toEqual([["apples"]]);
    expect(topK(buyApples, w("buy apples"), 5)).toEqual([]);
  });

  test("wanted sets are sorted and unions are reported per stuck alternative", () => {
    const spec = choice([tuple2(words(w("cancel stop halt")), word("order")), word("status")]);

    expect(topK(spec, w("canc"), 5)).toEqual([
      w("cancel halt status stop"),
      w("cancel halt status stop"),
    ]);
  });

  test("wanted tokens sort by code point", () => {
    const astral = String.fromCodePoint(0x1f600);
    const privateUse = String.fromCodePoint(0xe000);
    const spec = minimalToken([[0, astral], [0, privateUse], [0, "z"]]);

    // UTF-16 code unit order would put the astral character (a surrogate pair) before U+E000.
    expect(topK(spec, [], 1)).toEqual([["z", privateUse, astral]]);
  });

  test("suggestion lists are independent copies", () => {
    const [first, second] = topK(choice([word("cat"), word("dog")]), [], 5);
    first!.push("mutated");
    expect(second).toEqual(["cat", "dog"]);
  });

  test("wanted", () => {
    expect(wanted(word("hello"))).toEqual(new Set(["hello"]));
    expect(wanted(map2(word("a"), word("b"), pair))).toEqual(new Set(["a"]));
    expect(wanted(choice([word("a"), word("b")]))).toEqual(new Set(["a", "b"]));
    expect(wanted(pure(1))).toEqual(new Set());
  });
});

describe("grammar", () => {
  test("extracts and flattens", () => {
    const nat_: Grammar = { tag: "token", value: { tag: "nat" } };
    const empty: Grammar = { tag: "seq", value: [] };

    expect(grammar(word("hello"))).toEqual(lit("hello"));
    expect(grammar(tuple2(word("buy"), nat()))).toEqual({ tag: "seq", value: [lit("buy"), nat_] });

    expect(grammar(tuple3(word("a"), token(), int()))).toEqual({
      tag: "seq",
      value: [lit("a"), { tag: "anyToken" }, { tag: "token", value: { tag: "int" } }],
    });

    expect(grammar(choice([word("yes"), word("no")]))).toEqual({
      tag: "choice",
      value: [lit("yes"), lit("no")],
    });

    expect(grammar(repeat(nat()))).toEqual({ tag: "repeat", value: nat_ });

    expect(grammar(words(w("a b")))).toEqual({
      tag: "minimalToken",
      value: [{ weight: 0, text: "a" }, { weight: 1, text: "b" }],
    });

    expect(grammar(optional(nat()))).toEqual({ tag: "choice", value: [nat_, empty] });
    expect(grammar(pure(1))).toEqual(empty);
    expect(grammar(map(word("x"), (s) => s.toUpperCase()))).toEqual(lit("x"));
    expect(grammar(weight(word("x"), 2))).toEqual(lit("x"));
  });
});

describe("repeat guards against parsers that consume nothing", () => {
  test("throws instead of looping forever", () => {
    expect(() => runList(repeat(pure(1)), w("a b"))).toThrow(/without consuming a token/);
    expect(() => runList(repeat(optional(word("zzz"))), w("a b"))).toThrow(/without consuming/);
  });

  test("building such a parser is fine; only running it throws", () => {
    expect(() => repeat(pure(1))).not.toThrow();
  });
});
