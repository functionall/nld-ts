import { describe, expect, test } from "vitest";
import { downcase, tokenize } from "../src/index.js";

// Builds a string from code points, so this file stays ASCII whatever it has to mention.
const cp = (...codes: (number | string)[]): string =>
  codes.map((code) => (typeof code === "string" ? code : String.fromCodePoint(code))).join("");

const UPSTREAM: [string, string[]][] = [
  ["hello world", ["hello", "world"]],
  ["camelCase", ["camel", "Case"]],
  ["HTMLParser", ["HTML", "Parser"]],
  ["abcra123", ["abcra", "123"]],
  ["hello!", ["hello", "!"]],
  ["(hi)", ["(", "hi", ")"]],
  ["(hi!)", ["(", "hi", "!", ")"]],
  ["setHTMLParser", ["set", "HTML", "Parser"]],
  ["ABC123", ["ABC", "123"]],
  ["", []],
  ["   ", []],
  ["don't stop", ["don", "'", "t", "stop"]],
  ["it's a 'test'", ["it", "'", "s", "a", "'", "test", "'"]],
  ["3:30pm", ["3", ":", "30", "pm"]],
  ["$19.99", ["$", "19", ".", "99"]],
  ["2025-03-06", ["2025", "-", "03", "-", "06"]],
  ["buy 3 apples", ["buy", "3", "apples"]],
];

describe("tokenize", () => {
  test.each(UPSTREAM)("upstream case: %j", (input, expected) => {
    expect(tokenize(input)).toEqual(expected);
  });

  test("uncased scripts tokenize instead of truncating (documented deviation)", () => {
    const nihon = cp(0x65e5, 0x672c);
    expect(tokenize(nihon + "Parser")).toEqual([nihon, "Parser"]);
  });

  test("uppercase run splitting edge cases", () => {
    expect(tokenize("ABc")).toEqual(["A", "Bc"]);
    expect(tokenize("A")).toEqual(["A"]);
  });

  test("is safe to call repeatedly", () => {
    expect(tokenize("a b")).toEqual(["a", "b"]);
    expect(tokenize("a b")).toEqual(["a", "b"]);
  });

  // The tokenizer spells out its own classes instead of relying on JavaScript's `\s` and `\d`.
  test("whitespace includes U+0085 and U+180E but not U+FEFF", () => {
    expect(tokenize(cp("a", 0x85, "b"))).toEqual(["a", "b"]);
    expect(tokenize(cp("a", 0x180e, "b"))).toEqual(["a", "b"]);
    expect(tokenize(cp("a", 0xa0, "b"))).toEqual(["a", "b"]);
    expect(tokenize(cp("a", 0x2028, "b"))).toEqual(["a", "b"]);
    expect(tokenize(cp("a", 0xfeff, "b"))).toEqual(["a", cp(0xfeff), "b"]);
  });

  test("digits are any Unicode decimal digit", () => {
    const arabicIndic = cp(0x661, 0x662, 0x663);
    expect(tokenize(cp(arabicIndic, " x", 0x664))).toEqual([arabicIndic, "x", cp(0x664)]);
  });

  test("astral characters are single tokens", () => {
    expect(tokenize(cp("x", 0x1f600, "y"))).toEqual(["x", cp(0x1f600), "y"]);
  });
});

describe("downcase", () => {
  test("lowercases per code point", () => {
    expect(downcase("HTML")).toBe("html");
    expect(downcase(cp(0x130, "st"))).toBe(cp("i", 0x307, "st"));
  });

  test("has no final-sigma rule, unlike toLowerCase()", () => {
    const odos = cp(0x39f, 0x394, 0x39f, 0x3a3);
    expect(downcase(odos)).toBe(cp(0x3bf, 0x3b4, 0x3bf, 0x3c3));
    expect(odos.toLowerCase()).toBe(cp(0x3bf, 0x3b4, 0x3bf, 0x3c2));
  });
});
