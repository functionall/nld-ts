import { describe, expect, test } from "vitest";
import { Grammar, tokenType, type TokenType } from "../src/index.js";

const lit = (value: string): Grammar => ({ tag: "literal", value });
const nat: Grammar = { tag: "token", value: { tag: "nat" } };

// [grammar, the exact upstream encoding]
const EXAMPLES: [Grammar, string][] = [
  [nat, '{"tag":"token","value":{"tag":"nat"}}'],
  [
    { tag: "seq", value: [nat, { tag: "anyToken" }] },
    '{"tag":"seq","value":[{"tag":"token","value":{"tag":"nat"}},{"tag":"anyToken"}]}',
  ],
  [
    { tag: "minimalToken", value: [{ weight: 1, text: "hello" }, { weight: 0.5, text: "world" }] },
    '{"tag":"minimalToken","value":[{"weight":1.0,"text":"hello"},{"weight":0.5,"text":"world"}]}',
  ],
  [
    { tag: "token", value: { tag: "currency", value: "USD" } },
    '{"tag":"token","value":{"tag":"currency","value":"USD"}}',
  ],
  [lit("buy"), '{"tag":"literal","value":"buy"}'],
  [
    { tag: "choice", value: [lit("yes"), lit("no")] },
    '{"tag":"choice","value":[{"tag":"literal","value":"yes"},{"tag":"literal","value":"no"}]}',
  ],
  [
    { tag: "repeat", value: { tag: "token", value: { tag: "dateTime" } } },
    '{"tag":"repeat","value":{"tag":"token","value":{"tag":"dateTime"}}}',
  ],
];

describe("Grammar JSON", () => {
  test.each(EXAMPLES)("toJson is byte-identical to the upstream encoding: %j", (grammar, json) => {
    expect(Grammar.toJson(grammar)).toBe(json);
  });

  test.each(EXAMPLES)("fromJson round-trips %j", (grammar) => {
    expect(Grammar.safeFromJson(Grammar.toJson(grammar))).toEqual({ ok: true, grammar });
    expect(Grammar.fromJson(Grammar.toJson(grammar))).toEqual(grammar);
  });

  test("a grammar is its own JSON encoding", () => {
    for (const [grammar, json] of EXAMPLES) {
      expect(JSON.parse(JSON.stringify(grammar))).toEqual(JSON.parse(json));
      expect(Grammar.decode(JSON.parse(json))).toEqual({ ok: true, grammar });
    }
  });

  test("every token type round-trips", () => {
    const types: TokenType[] = [
      { tag: "nat" },
      { tag: "int" },
      { tag: "float" },
      { tag: "boolean" },
      { tag: "date" },
      { tag: "dateTime" },
      { tag: "time" },
      { tag: "currency", value: "EUR" },
    ];

    for (const value of types) {
      const grammar: Grammar = { tag: "token", value };
      expect(Grammar.fromJson(Grammar.toJson(grammar))).toEqual(grammar);
    }
  });

  test("integer weights are encoded as floats", () => {
    expect(Grammar.toJson({ tag: "minimalToken", value: [{ weight: 1, text: "a" }] })).toBe(
      '{"tag":"minimalToken","value":[{"weight":1.0,"text":"a"}]}',
    );

    const weights = [0, -2, 0.25, 1e21, 1e-7].map((weight) => ({ weight, text: "a" }));
    const json = Grammar.toJson({ tag: "minimalToken", value: weights });
    expect(json).toContain('"weight":0.0,');
    expect(json).toContain('"weight":-2.0,');
    expect(json).toContain('"weight":0.25,');
    expect(Grammar.fromJson(json)).toEqual({ tag: "minimalToken", value: weights });
  });

  test("weights that JSON cannot represent are refused", () => {
    const grammar: Grammar = { tag: "minimalToken", value: [{ weight: Infinity, text: "a" }] };
    expect(() => Grammar.toJson(grammar)).toThrow(RangeError);
  });

  test("text is escaped", () => {
    const grammar = lit('say "hi"\n');
    expect(Grammar.fromJson(Grammar.toJson(grammar))).toEqual(grammar);
  });

  test("fromJson reports errors", () => {
    expect(Grammar.safeFromJson('{"tag":"nope"}')).toEqual({
      ok: false,
      error: "invalid Grammar tag: nope",
    });

    expect(Grammar.safeFromJson('{"tag":"token","value":{"tag":"bogus"}}')).toEqual({
      ok: false,
      error: "invalid TokenType tag: bogus",
    });

    expect(Grammar.safeFromJson('{"tag":"literal","value":1}')).toEqual({
      ok: false,
      error: "invalid Grammar tag: literal",
    });

    expect(Grammar.safeFromJson('{"tag":"seq","value":[{"tag":"bogus"}]}')).toEqual({
      ok: false,
      error: "invalid Grammar tag: bogus",
    });

    expect(
      Grammar.safeFromJson('{"tag":"minimalToken","value":[{"weight":"1","text":"a"}]}'),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/^invalid minimalToken entry/) });

    expect(Grammar.safeFromJson("not json")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^invalid JSON/),
    });

    expect(Grammar.safeFromJson("[1,2]")).toMatchObject({ ok: false });
    expect(Grammar.safeFromJson("null")).toMatchObject({ ok: false });
    expect(() => Grammar.fromJson('{"tag":"bogus"}')).toThrow(/invalid grammar JSON/);
  });
});

describe("Grammar helpers", () => {
  test("seq and choice flatten nested nodes and handle empty lists", () => {
    expect(Grammar.seq([])).toEqual({ tag: "seq", value: [] });

    expect(Grammar.seq([lit("a"), { tag: "seq", value: [lit("b"), lit("c")] }])).toEqual({
      tag: "seq",
      value: [lit("a"), lit("b"), lit("c")],
    });

    expect(Grammar.choice([])).toEqual({ tag: "choice", value: [] });

    expect(Grammar.choice([lit("a"), { tag: "choice", value: [lit("b"), lit("c")] }])).toEqual({
      tag: "choice",
      value: [lit("a"), lit("b"), lit("c")],
    });
  });

  test("format", () => {
    expect(Grammar.format({ tag: "seq", value: [lit("set"), nat] })).toBe(
      'seq [literal "set", token nat]',
    );

    expect(Grammar.format({ tag: "token", value: { tag: "currency", value: "USD" } })).toBe(
      'token currency "USD"',
    );
  });

  test("tokenType expands the string shorthand", () => {
    expect(tokenType("nat")).toEqual({ tag: "nat" });
    expect(tokenType({ tag: "currency", value: "USD" })).toEqual({ tag: "currency", value: "USD" });
  });
});
