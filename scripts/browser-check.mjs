// Proves the library runs natively in a browser: serves this package over HTTP like a static
// site, opens test/browser/check.html in headless Chromium, and replays every recorded
// conformance case against the built bundles, inside the browser.
//
//     pnpm build && pnpm test:browser
//
// Needs a Chromium-family browser: set CHROME_BIN, or have one on the PATH, or have Playwright's
// browsers installed (`npx playwright install chromium`).

import { execFile, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { serve } from "./static-server.mjs";

function findBrowser() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;

  const cache = join(homedir(), ".cache", "ms-playwright");

  if (existsSync(cache)) {
    const newestFirst = readdirSync(cache).sort((a, b) => b.localeCompare(a, "en", { numeric: true }));

    for (const dir of newestFirst) {
      for (const candidate of [
        join(cache, dir, "chrome-headless-shell-linux64", "chrome-headless-shell"),
        join(cache, dir, "chrome-linux64", "chrome"),
        join(cache, dir, "chrome-linux", "chrome"),
      ]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    if (spawnSync("which", [name]).status === 0) return name;
  }

  return null;
}

const browser = findBrowser();

if (browser === null) {
  console.error("No Chromium-family browser found. Set CHROME_BIN or run `npx playwright install chromium`.");
  process.exit(2);
}

if (!existsSync("dist/nld.min.js") || !existsSync("dist/nld.global.min.js")) {
  console.error("dist/ is missing: run `pnpm build` first.");
  process.exit(2);
}

// Bundle the in-browser test, pointing its import of the library at the built ES module so the
// page loads /dist/nld.min.js over HTTP exactly as a static site would.
await build({
  entryPoints: ["test/browser/check.ts"],
  bundle: true,
  format: "esm",
  target: "es2020",
  outfile: "dist-test/browser-check.js",
  logLevel: "warning",
  plugins: [
    {
      name: "use-built-library",
      setup(build) {
        build.onResolve({ filter: /\/src\/index\.js$/ }, () => ({ path: "/dist/nld.min.js", external: true }));
      },
    },
  ],
});

const server = await serve(".");

try {
  // Asynchronous on purpose: the server above runs in this process, so blocking the event loop
  // while the browser loads the page would deadlock.
  const { stdout: dom } = await promisify(execFile)(
    browser,
    ["--headless", "--no-sandbox", "--disable-gpu", "--virtual-time-budget=60000", "--dump-dom", `${server.url}/test/browser/check.html`],
    { encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
  );

  const match = /<pre id="result"[^>]*>([^<]*)<\/pre>/.exec(dom);

  if (!match || match[1] === "") {
    console.error("The page did not report a result. DOM was:\n" + dom.slice(0, 2000));
    process.exit(1);
  }

  const summary = JSON.parse(decodeURIComponent(match[1]));
  console.log(JSON.stringify(summary, null, 2));
  console.log(summary.ok ? "\nbrowser check passed" : "\nbrowser check FAILED");
  process.exitCode = summary.ok ? 0 : 1;
} finally {
  await server.close();
}
