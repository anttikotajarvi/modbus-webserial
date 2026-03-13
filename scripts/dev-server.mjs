/* eslint-disable no-undef */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

const port = Number(process.argv[2]) || 3000;

const examplesRoot = path.join(process.cwd(), "examples");
const distRoot = path.join(process.cwd(), "dist");

const clients = new Set();

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

function send(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    const ext = path.extname(file);
    const type = mime[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": type });

    if (ext === ".html") {
      data += `
<script>
const es = new EventSource("/__reload")
es.onmessage = () => location.reload()
</script>`;
    }

    res.end(data);
  });
}

http
  .createServer((req, res) => {
    const u = new URL(req.url, `http://localhost:${port}`);

    if (
      u.searchParams.has("local") &&
      !u.pathname.startsWith("/dist/") &&
      u.pathname !== "/__reload"
    ) {
      u.searchParams.delete("local");

      const origin = `http://${req.headers.host}`;
      u.searchParams.set("src", `${origin}/dist/index.js`);

      res.writeHead(302, {
        Location: u.pathname + "?" + u.searchParams.toString(),
      });

      res.end();
      return;
    }

    /* ---------- reload channel ---------- */

    if (u.pathname === "/__reload") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    /* ---------- dist mount ---------- */

    if (u.pathname.startsWith("/dist/")) {
      const file = path.join(distRoot, u.pathname.replace("/dist/", ""));
      return send(res, file);
    }

    /* ---------- examples root ---------- */

    let file = path.join(examplesRoot, u.pathname);

    if (u.pathname === "/") {
      file = path.join(examplesRoot, "index.html");
    }

    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      file = path.join(file, "index.html");
    }

    send(res, file);
  })
  .listen(port, () => {
    console.log(`dev server @ http://localhost:${port}`);
  });

fs.watch(process.cwd(), { recursive: true }, (_, file) => {
  if (!file || file.includes("node_modules")) return;
  for (const c of clients) c.write("data: reload\n\n");
});
