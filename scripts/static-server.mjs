// A minimal static file server, for the browser check. Development only.

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

/** Serves `root` on `port` (0 picks a free one). Resolves to `{ url, close }`. */
export function serve(root, port = 0) {
  const base = resolve(root);

  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let file = normalize(join(base, pathname));

    if (file !== base && !file.startsWith(base + sep)) {
      response.writeHead(403).end("forbidden");
      return;
    }

    try {
      if (statSync(file).isDirectory()) file = join(file, "index.html");
      statSync(file);
    } catch {
      response.writeHead(404).end("not found");
      return;
    }

    response.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });

    createReadStream(file).pipe(response);
  });

  return new Promise((ready) => {
    server.listen(port, "127.0.0.1", () => {
      ready({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((closed) => server.close(closed)),
      });
    });
  });
}
