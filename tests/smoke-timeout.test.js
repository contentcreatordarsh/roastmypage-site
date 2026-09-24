import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("smoke suite aborts a response body that never finishes", { timeout: 5000 }, async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.write("<h1>Roast");
    // Deliberately leave the body open, matching a broken streaming deployment.
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address();
  const child = spawn(
    process.execPath,
    [join(root, "scripts/smoke.mjs"), `http://127.0.0.1:${port}`],
    {
      env: { ...process.env, SMOKE_REQUEST_TIMEOUT_MS: "100" },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const watchdog = setTimeout(() => child.kill("SIGTERM"), 3000);
  const startedAt = Date.now();
  const [code, signal] = await once(child, "exit");
  clearTimeout(watchdog);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));

  assert.equal(signal, null, "smoke process should fail itself, not need termination");
  assert.equal(code, 1);
  assert.ok(Date.now() - startedAt < 2000, "smoke failure should be prompt");
  assert.match(stderr, /timeout|aborted/i);
});
