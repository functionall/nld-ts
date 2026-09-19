# nld-ts: Natural Language Disambiguators for the browser

`nld-ts` turns loosely phrased natural language into a small set of structured commands,
deterministically and in microseconds, **entirely in the browser**: no backend, no model, no
network calls, no dependencies.

It is a TypeScript port of [`@pchiusano/nlds`](https://share.unison-lang.org/@pchiusano/nlds),
Paul Chiusano's Unison library, described in
[Natural Language Disambiguators: LLMs are slow and costly for intent classification](https://structural.chat/articles/nlds/).

A spec looks only for the tokens you name and ignores everything else ("please", "my", "I'd
like to"), accepts them in any order (the specified order is preferred), ranks every possible
parse best-first, and can tell you which tokens would let an incomplete input parse, which makes
real-time autocomplete trivial.

```ts
import { best, choice, ignore, nat, suggest, word, words } from "nld-ts";

const cancel = ignore(words(["cancel", "stop", "halt"]))
  .ignore(word("order"))
  .optional(nat())
  .tag("cancel_order");

const status = ignore(word("order"))
  .ignore(word("status"))
  .optional(nat())
  .tag("order_status");

const intents = choice([cancel, status]);

best(intents, "Please cancel my order 42");    // => [{ tag: "cancel_order", value: [42] }]
best(intents, "stop the order, number 42");    // => [{ tag: "cancel_order", value: [42] }]
best(intents, "what's the status of order 7"); // => [{ tag: "order_status", value: [7] }]
best(intents, "tell me a joke");               // => null

suggest(cancel, "cancel");                     // => [["order"]]
```

Results are fully typed. `best(intents, text)` above is inferred as
`[Tagged<"cancel_order", [] | [number]>] | [Tagged<"order_status", [] | [number]>] | null`, so
switching on `tag` narrows `value`.

## Using it on a static site

Run `pnpm install && pnpm build` once. `dist/` then holds three ways to consume the library; pick
whichever fits the site.

**As an ES module, no build step.** Copy `dist/nld.min.js` next to your page:

```html
<script type="module">
  import { best, ignore, nat, word, words } from "./nld.min.js";

  const cancel = ignore(words(["cancel", "stop"])).ignore(word("order")).optional(nat()).tag("cancel");
  console.log(best(cancel, "please stop my order 42"));
</script>
```

**As a classic script.** Copy `dist/nld.global.min.js`; it defines the global `Nld`. Unlike module
imports, this also works when the page is opened straight from disk (`file://`):

```html
<script src="./nld.global.min.js"></script>
<script>
  const { best, word } = Nld;
</script>
```

**With a bundler.** `dist/index.js` and its type declarations are what the package's `exports`
point to. Import from `"nld-ts"`, or from `"nld-ts/core"` for the low-level combinators alone. The
chainable `Spec` class refers to every builder, so importing anything from `"nld-ts"` costs close
to the full 15 kB; `"nld-ts/core"` on its own bundles to under 6 kB.

The code targets ES2020 and uses nothing beyond the language itself (no DOM, no Node APIs), so it
also runs in web workers, Node, Deno and Bun.

## How it works

Instead of a token sequence, the input is a *position-annotated multiset*: a map from token to
the positions where it appears. Each leaf parser looks its token up directly, consumes one
occurrence, and pays a cost equal to the distance from the previous match (backward jumps cost
1.5x plus one). Synonyms carry an extra base weight. A best-first search explores all parses in
order of total cost and yields them lazily, so the first result is the best one and nothing more
is explored than necessary.

Autocomplete runs the same search and, wherever a branch gets stuck, reports the tokens that
would have let it continue.

## API

The package entry point is the chainable builder API: every builder exists as a **function** that
starts a spec and as a **method** that continues one, as in `ignore(word("set")).nat()`. A spec
yields a list of results, shaped with `ignore`, `tag`, `unwrapAndTag`, `wrap`, `reduce`, `map` and
`replace`.

| | |
| --- | --- |
| Leaves | `word`, `words`, `minimalToken`, `phrase`, `token`, `tokenMatching`, `tokenOfType`, `nat`, `int`, `float`, `boolean`, and an `indexed...` variant of each that also yields the token's position |
| Combinators | `choice`, `repeat`, `optional`, `ignore`, `wrap`, `concat`, `empty`, and `Spec.from` to make a `Core` parser chainable |
| Shaping | `tag`, `unwrapAndTag`, `reduce`, `map`, `replace` |
| Runners | `parse`, `best`, `run` (lazy `[weight, results]`), `suggest`, `autocomplete` |
| Introspection | `grammar`, `wanted`, `tokenize`, `downcase`, `String(spec)` |

The shaping builders go by arity. With one argument the method shapes everything so far; with two
it continues with its own spec:

```ts
word("a").word("b").tag("ab");        // [{ tag: "ab", value: ["a", "b"] }]
word("a").tag(word("b"), "b").word("c"); // ["a", { tag: "b", value: ["b"] }, "c"]
```

The runners accept a string or a token list. Strings are split with `tokenize` and downcased
(pass `{ downcase: false }` to keep case, or `{ tokenizer }` to split differently); token lists
are used exactly as given. `parse` and `suggest` take `{ limit }`. Every runner is also a method:
`intents.best(text)`.

Pairs are arrays (`[value, position]`, `[weight, results]`, `[weight, token]`) and tagged results
are `{ tag, value }` objects. `best` returns `null` when nothing parses, a token parser returns
`undefined` to reject a token, and `run` and `autocomplete` return generators: lazy, but consumed
once, so call them again to restart.

`Core` (also importable as `"nld-ts/core"`) is the one-to-one port of the upstream combinators
(`word`, `words`, `minimalToken`, `token`, `nat`, `map2`, `tuple2`, `sequence`, `choice`,
`repeat`, `runList`, `topK`, ...) on bare values; every example in the upstream documentation
runs unchanged against it.

`Grammar` is the serializable description of a spec (`grammar(spec)`). A grammar value *is* its
upstream JSON encoding, so `JSON.stringify` already works; `Grammar.toJson` additionally matches
upstream byte for byte (key order, weights written as floats), and `Grammar.fromJson`,
`Grammar.safeFromJson` and `Grammar.decode` validate what comes back.


## Development

```
pnpm install
pnpm test           # unit, property, type-level and conformance tests
pnpm build          # dist/: ES modules + types, nld.min.js, nld.global.min.js
pnpm test:browser   # the conformance suite again, inside headless Chromium
pnpm check          # all of the above, plus the typecheck
```

`pnpm test:browser` needs a Chromium-family browser: set `CHROME_BIN`, have one on the `PATH`, or
run `npx playwright install chromium`.

Use pnpm (or any manager but npm 10.9, whose resolver crashes on this dependency tree). There are
no runtime dependencies.

## License

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 Function All Ltd. This is a port of
[`@pchiusano/nlds`](https://share.unison-lang.org/@pchiusano/nlds), copyright (c) 2026 Unison
Computing, public benefit corp, also under the MIT license.
