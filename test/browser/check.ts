/// <reference lib="dom" />

// Runs inside a real browser (see scripts/browser-check.mjs): every recorded conformance case is
// replayed against the *built* ES module bundle, exactly as a static site would load it, and the
// classic-script build (`window.Nld`) is exercised as well.
//
// When this file is bundled for the browser, the import of the library's source is redirected to
// /dist/nld.min.js, so nothing here (or in support/) touches unbuilt code.

import * as N from "../../src/index.js";
import { actual, expected, type Fixtures } from "../support/fixtures.js";

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

function checkEsm(fixtures: Fixtures): { checked: number; failures: string[] } {
  const failures: string[] = [];

  fixtures.cases.forEach((c, i) => {
    if (!equal(actual(c, fixtures.limit), expected(c))) {
      failures.push(`case #${i}: ${JSON.stringify(c.spec).slice(0, 120)}`);
    }
  });

  for (const { text, tokens, downcased } of fixtures.tokenizer) {
    const split = N.tokenize(text);
    if (!equal(split, tokens) || !equal(split.map(N.downcase), downcased)) {
      failures.push(`tokenize ${JSON.stringify(text)}`);
    }
  }

  return { checked: fixtures.cases.length + fixtures.tokenizer.length, failures };
}

// The classic-script build, used the way a page without modules would use it.
function checkGlobal(): { checked: number; failures: string[] } {
  const Nld = (globalThis as unknown as { Nld?: typeof N }).Nld;
  if (Nld === undefined) return { checked: 0, failures: ["window.Nld is not defined"] };

  const cancel = Nld.ignore(Nld.words(["cancel", "stop", "halt"]))
    .ignore(Nld.word("order"))
    .optional(Nld.nat())
    .tag("cancel_order");

  const status = Nld.ignore(Nld.word("order")).ignore(Nld.word("status")).optional(Nld.nat()).tag("order_status");
  const intents = Nld.choice([cancel, status]);

  const expectations: [string, unknown, unknown][] = [
    ["best", Nld.best(intents, "Please cancel my order 42"), [{ tag: "cancel_order", value: [42] }]],
    ["best, reordered", Nld.best(intents, "stop the order, number 42"), [{ tag: "cancel_order", value: [42] }]],
    ["best, other intent", Nld.best(intents, "what's the status of order 7"), [{ tag: "order_status", value: [7] }]],
    ["best, no parse", Nld.best(intents, "tell me a joke"), null],
    ["suggest", Nld.suggest(cancel, "cancel"), [["order"]]],
    ["run weights", [...Nld.run(Nld.word("set").nat(), "set the value to 42")], [[4, ["set", 42]]]],
    ["Core", Nld.Core.runList(Nld.Core.tuple2(Nld.Core.word("buy"), Nld.Core.nat()), ["3", "buy"]), [["buy", 3]]],
    ["tokenize", Nld.tokenize("setHTMLParser $19.99"), ["set", "HTML", "Parser", "$", "19", ".", "99"]],
    ["Grammar.toJson", Nld.Grammar.toJson(Nld.grammar(Nld.word("buy").nat())), '{"tag":"seq","value":[{"tag":"literal","value":"buy"},{"tag":"token","value":{"tag":"nat"}}]}'],
    ["toString", String(Nld.word("set").nat()), '#Nld<seq [literal "set", token nat]>'],
  ];

  const failures = expectations
    .filter(([, actual, expected]) => !equal(actual, expected))
    .map(([name, actual]) => `${name}: got ${JSON.stringify(actual)}`);

  return { checked: expectations.length, failures };
}

async function main(): Promise<void> {
  let summary: Record<string, unknown>;

  try {
    const fixtures = (await (await fetch("/test/fixtures/conformance.json")).json()) as Fixtures;
    const esm = checkEsm(fixtures);
    const global = checkGlobal();

    summary = {
      ok: esm.failures.length === 0 && global.failures.length === 0,
      esm: { checked: esm.checked, failed: esm.failures.length, first: esm.failures.slice(0, 5) },
      global: { checked: global.checked, failed: global.failures.length, first: global.failures.slice(0, 5) },
      userAgent: navigator.userAgent,
    };
  } catch (error) {
    summary = { ok: false, error: String(error instanceof Error ? (error.stack ?? error) : error) };
  }

  document.getElementById("status")!.textContent = JSON.stringify(summary, null, 2);
  // URI-encoded so that the runner can read it back out of the serialized DOM unambiguously.
  document.getElementById("result")!.textContent = encodeURIComponent(JSON.stringify(summary));
}

void main();
