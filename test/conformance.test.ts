// Reference tests. test/fixtures/conformance.json records the expected behaviour for ~1900 specs
// and inputs; the library must agree on every weight, result, tie order, suggestion, grammar and
// token.

import { describe, expect, test } from "vitest";
import { downcase, tokenize } from "../src/index.js";
import raw from "./fixtures/conformance.json?raw";
import { actual, expected, inputOf, type Fixtures } from "./support/fixtures.js";

const fixtures = JSON.parse(raw) as Fixtures;

describe("conformance", () => {
  test("the fixtures are present and substantial", () => {
    expect(fixtures.cases.length).toBeGreaterThan(1500);
    expect(fixtures.tokenizer.length).toBeGreaterThan(50);
    expect(fixtures.limit).toBeGreaterThan(0);
  });

  fixtures.cases.forEach((c, i) => {
    const name = `#${i} ${c.layer} ${JSON.stringify(c.spec).slice(0, 70)} <= ${JSON.stringify(inputOf(c))}`;

    test(name, () => {
      expect(actual(c, fixtures.limit)).toEqual(expected(c));
    });
  });
});

describe("tokenizer conformance", () => {
  const hex = (text: string) => Array.from(text, (ch) => ch.codePointAt(0)!.toString(16)).join(" ");

  test.each(fixtures.tokenizer)("tokenize and downcase [$text]", ({ text, tokens, downcased }) => {
    // Compared as code points so that a failure on an invisible character is legible.
    expect(tokenize(text).map(hex)).toEqual(tokens.map(hex));
    expect(tokenize(text).map(downcase).map(hex)).toEqual(downcased.map(hex));
  });
});
