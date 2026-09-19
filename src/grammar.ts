/** The kind of value a typed token holds. `currency` carries an ISO 4217 code. */
export type TokenType =
  | { readonly tag: "nat" }
  | { readonly tag: "int" }
  | { readonly tag: "float" }
  | { readonly tag: "boolean" }
  | { readonly tag: "date" }
  | { readonly tag: "dateTime" }
  | { readonly tag: "time" }
  | { readonly tag: "currency"; readonly value: string };

/** The token types that carry no value, usable as a shorthand wherever a {@link TokenType} is. */
export type TokenTypeName = Exclude<TokenType["tag"], "currency">;

/** One weighted alternative of a `minimalToken` grammar. */
export interface WeightedText {
  readonly weight: number;
  readonly text: string;
}

/**
 * A first-class, serializable description of what an `Nld` parser expects.
 *
 * Every parser carries its grammar (see `grammar()`). Grammars are plain data, and their shape
 * *is* the JSON encoding of the upstream Unison library, so a grammar can be handed to another
 * system (for example a richer autocomplete UI) with `JSON.stringify`, or with
 * {@link Grammar.toJson} to also match upstream's key order and float formatting:
 *
 *   - `{ tag: "literal", value }`: a specific token
 *   - `{ tag: "minimalToken", value: [{ weight, text }] }`: one of several weighted alternatives
 *     (synonyms)
 *   - `{ tag: "anyToken" }`: any token (possibly filtered by a predicate the grammar cannot
 *     express)
 *   - `{ tag: "token", value: tokenType }`: a typed token, see {@link TokenType}
 *   - `{ tag: "seq", value: grammars }`, `{ tag: "choice", value: grammars }`,
 *     `{ tag: "repeat", value: grammar }`
 */
export type Grammar =
  | { readonly tag: "literal"; readonly value: string }
  | { readonly tag: "minimalToken"; readonly value: readonly WeightedText[] }
  | { readonly tag: "anyToken" }
  | { readonly tag: "token"; readonly value: TokenType }
  | { readonly tag: "seq"; readonly value: readonly Grammar[] }
  | { readonly tag: "choice"; readonly value: readonly Grammar[] }
  | { readonly tag: "repeat"; readonly value: Grammar };

/** The outcome of {@link Grammar.safeFromJson} and {@link Grammar.decode}. */
export type GrammarResult =
  | { readonly ok: true; readonly grammar: Grammar }
  | { readonly ok: false; readonly error: string };

const TOKEN_TYPE_NAMES: readonly string[] = [
  "nat",
  "int",
  "float",
  "boolean",
  "date",
  "dateTime",
  "time",
];

/** Expands the string shorthand for a token type (`"nat"` becomes `{ tag: "nat" }`). */
export function tokenType(type: TokenType | TokenTypeName): TokenType {
  return typeof type === "string" ? { tag: type } : type;
}

/**
 * Combines grammars into a single `seq`, flattening nested sequences.
 *
 * @example
 * Grammar.seq([lit("a"), { tag: "seq", value: [lit("b"), lit("c")] }])
 * // => { tag: "seq", value: [lit("a"), lit("b"), lit("c")] }
 * Grammar.seq([]) // => { tag: "seq", value: [] }
 */
function seq(grammars: readonly Grammar[]): Grammar {
  return { tag: "seq", value: grammars.flatMap((g) => (g.tag === "seq" ? g.value : [g])) };
}

/**
 * Combines grammars into a single `choice`, flattening nested choices.
 *
 * @example
 * Grammar.choice([lit("a"), { tag: "choice", value: [lit("b"), lit("c")] }])
 * // => { tag: "choice", value: [lit("a"), lit("b"), lit("c")] }
 */
function choice(grammars: readonly Grammar[]): Grammar {
  return { tag: "choice", value: grammars.flatMap((g) => (g.tag === "choice" ? g.value : [g])) };
}

/**
 * Encodes a grammar as JSON exactly as upstream does: same key order, and weights always
 * written as floats (`1.0`, not `1`).
 *
 * @example
 * Grammar.toJson({ tag: "token", value: { tag: "nat" } })
 * // => '{"tag":"token","value":{"tag":"nat"}}'
 * Grammar.toJson({ tag: "minimalToken", value: [{ weight: 1, text: "hello" }] })
 * // => '{"tag":"minimalToken","value":[{"weight":1.0,"text":"hello"}]}'
 */
function toJson(grammar: Grammar): string {
  switch (grammar.tag) {
    case "literal":
      return `{"tag":"literal","value":${JSON.stringify(grammar.value)}}`;

    case "minimalToken": {
      const pairs = grammar.value.map(
        ({ weight, text }) => `{"weight":${encodeFloat(weight)},"text":${JSON.stringify(text)}}`,
      );
      return `{"tag":"minimalToken","value":[${pairs.join(",")}]}`;
    }

    case "anyToken":
      return `{"tag":"anyToken"}`;

    case "token":
      return `{"tag":"token","value":${encodeTokenType(grammar.value)}}`;

    case "seq":
    case "choice":
      return `{"tag":"${grammar.tag}","value":[${grammar.value.map(toJson).join(",")}]}`;

    case "repeat":
      return `{"tag":"repeat","value":${toJson(grammar.value)}}`;
  }
}

function encodeTokenType(type: TokenType): string {
  return type.tag === "currency"
    ? `{"tag":"currency","value":${JSON.stringify(type.value)}}`
    : `{"tag":"${type.tag}"}`;
}

function encodeFloat(weight: number): string {
  if (!Number.isFinite(weight)) throw new RangeError(`cannot encode weight ${weight} as JSON`);
  const text = String(weight);
  return /^-?\d+$/.test(text) ? `${text}.0` : text;
}

/**
 * Decodes a grammar from its JSON encoding, returning `{ ok: true, grammar }` or
 * `{ ok: false, error }`.
 *
 * @example
 * Grammar.safeFromJson('{"tag":"nope"}') // => { ok: false, error: "invalid Grammar tag: nope" }
 */
function safeFromJson(text: string): GrammarResult {
  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${error instanceof Error ? error.message : error}` };
  }

  return decode(data);
}

/**
 * Like {@link safeFromJson} but returns the grammar and throws on invalid input.
 *
 * @example
 * Grammar.fromJson('{"tag":"seq","value":[{"tag":"literal","value":"buy"},{"tag":"anyToken"}]}')
 * // => { tag: "seq", value: [{ tag: "literal", value: "buy" }, { tag: "anyToken" }] }
 */
function fromJson(text: string): Grammar {
  const result = safeFromJson(text);
  if (result.ok) return result.grammar;
  throw new Error(`invalid grammar JSON: ${result.error}`);
}

/** Validates an already parsed JSON value (for example from `response.json()`) as a grammar. */
function decode(data: unknown): GrammarResult {
  try {
    return { ok: true, grammar: dec(data) };
  } catch (error) {
    if (error instanceof DecodeError) return { ok: false, error: error.message };
    throw error;
  }
}

class DecodeError extends Error {}

function dec(data: unknown): Grammar {
  if (!isObject(data) || typeof data.tag !== "string") {
    throw new DecodeError(`invalid Grammar: ${JSON.stringify(data)}`);
  }

  const { tag, value } = data;

  if (tag === "literal" && typeof value === "string") return { tag, value };
  if (tag === "minimalToken" && Array.isArray(value)) return { tag, value: value.map(decPair) };
  if (tag === "anyToken") return { tag };
  if (tag === "token") return { tag, value: decType(value) };
  if ((tag === "seq" || tag === "choice") && Array.isArray(value)) return { tag, value: value.map(dec) };
  if (tag === "repeat") return { tag, value: dec(value) };

  throw new DecodeError(`invalid Grammar tag: ${tag}`);
}

function decPair(data: unknown): WeightedText {
  if (isObject(data) && typeof data.weight === "number" && typeof data.text === "string") {
    return { weight: data.weight, text: data.text };
  }

  throw new DecodeError(`invalid minimalToken entry: ${JSON.stringify(data)}`);
}

function decType(data: unknown): TokenType {
  if (!isObject(data) || typeof data.tag !== "string") {
    throw new DecodeError(`invalid TokenType: ${JSON.stringify(data)}`);
  }

  if (TOKEN_TYPE_NAMES.includes(data.tag)) return { tag: data.tag as TokenTypeName };
  if (data.tag === "currency" && typeof data.value === "string") {
    return { tag: "currency", value: data.value };
  }

  throw new DecodeError(`invalid TokenType tag: ${data.tag}`);
}

function isObject(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

/**
 * A compact, human-readable rendering, used by `toString()` on `Nld` values.
 *
 * @example
 * Grammar.format({ tag: "seq", value: [{ tag: "literal", value: "set" }, { tag: "anyToken" }] })
 * // => 'seq [literal "set", anyToken]'
 */
function format(grammar: Grammar): string {
  switch (grammar.tag) {
    case "literal":
      return `literal ${JSON.stringify(grammar.value)}`;

    case "minimalToken": {
      const pairs = grammar.value.map(({ weight, text }) => `${weight} ${JSON.stringify(text)}`);
      return `minimalToken [${pairs.join(", ")}]`;
    }

    case "anyToken":
      return "anyToken";

    case "token":
      return grammar.value.tag === "currency"
        ? `token currency ${JSON.stringify(grammar.value.value)}`
        : `token ${grammar.value.tag}`;

    case "seq":
    case "choice":
      return `${grammar.tag} [${grammar.value.map(format).join(", ")}]`;

    case "repeat":
      return `repeat (${format(grammar.value)})`;
  }
}

/** Functions over {@link Grammar} values. */
export const Grammar = { seq, choice, toJson, fromJson, safeFromJson, decode, format } as const;
