// Builds dist/:
//
//   index.js, core.js, ... (+ .d.ts)   ES modules for bundlers and `import` from npm-style setups
//   nld.min.js                         the whole library as one minified ES module, for
//                                      `<script type="module">` on a static site
//   nld.global.min.js                  the same as a classic script defining `window.Nld`, which
//                                      also works from file:// where module imports do not

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });

// The local compiler, run directly so the build does not depend on a particular package manager.
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], {
  stdio: "inherit",
});

const { name, version } = JSON.parse(readFileSync("package.json", "utf8"));

// The standalone bundles get copied around without the LICENSE file, so they carry its notice.
const notice = [
  `${name} ${version}: Natural Language Disambiguators`,
  "MIT License",
  "(c) 2026 Function All Ltd",
  "(c) 2026 Unison Computing, public benefit corp (the original @pchiusano/nlds)",
].join(" | ");

const bundle = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  sourcemap: true,
  target: "es2020",
  legalComments: "none",
  banner: { js: `/*! ${notice} */` },
};

await build({ ...bundle, format: "esm", outfile: "dist/nld.min.js" });
await build({ ...bundle, format: "iife", globalName: "Nld", outfile: "dist/nld.global.min.js" });

for (const file of ["dist/nld.min.js", "dist/nld.global.min.js"]) {
  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
  console.log(`${file}  ${kb(statSync(file).size)}  (${kb(gzipSync(readFileSync(file)).length)} gzipped)`);
}
