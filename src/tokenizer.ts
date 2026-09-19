// Digits are any Unicode decimal digit; whitespace is the separators `\p{Z}`, the ASCII controls,
// U+0085 and U+180E. JavaScript's `\d` is ASCII only, and its `\s` lacks the last two and adds
// U+FEFF, so both classes are spelled out.
const DIGIT = "\\p{Nd}";
const SPACE = "\\t\\n\\v\\f\\r\\u0085\\u180e\\p{Z}";

const RE = new RegExp(
  [
    "\\p{Lu}\\p{Ll}+",
    "\\p{Lu}+(?!\\p{Ll})",
    "\\p{Ll}+",
    `${DIGIT}+`,
    "(?:(?![\\p{Lu}\\p{Ll}])\\p{L})+",
    `[^\\p{L}${DIGIT}${SPACE}]`,
  ].join("|"),
  "gu",
);

/**
 * Splits text into tokens for `Nld` parsers, mirroring upstream `Nld.tokenize`.
 *
 * Rules, in order of precedence:
 *
 *   - whitespace separates tokens and is discarded;
 *   - `camelCase` splits at lowercase-to-uppercase boundaries;
 *   - runs of uppercase letters stay together, splitting before a final uppercase letter that is
 *     followed by lowercase (`"HTMLParser"` gives `"HTML"` and `"Parser"`);
 *   - letters and digits are split from each other;
 *   - every other non-whitespace character is its own token.
 *
 * One documented deviation from upstream: runs of letters that have no case (for example CJK
 * scripts) become tokens instead of silently ending tokenization.
 *
 * @example
 * tokenize("setHTMLParser") // => ["set", "HTML", "Parser"]
 * tokenize("$19.99") // => ["$", "19", ".", "99"]
 * tokenize("don't stop") // => ["don", "'", "t", "stop"]
 * tokenize("   ") // => []
 */
export function tokenize(text: string): string[] {
  return text.match(RE) ?? [];
}

/**
 * Lowercases a token one code point at a time. Unlike `String.prototype.toLowerCase`, this is
 * context-free: a final `Σ` becomes `σ`, not `ς`, so a token lowercases the same way wherever
 * it appears.
 */
export function downcase(token: string): string {
  let out = "";
  for (const char of token) out += char.toLowerCase();
  return out;
}
