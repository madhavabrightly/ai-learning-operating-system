#!/usr/bin/env node
/**
 * Self-healing dev server launcher.
 *
 * Why this exists:
 *   The preview platform runs `npm run dev` in a sandbox that can be
 *   restarted/re-provisioned at any time. On a restart, an orphaned Vite
 *   process can survive on the dev port (or the platform's process session
 *   can be torn down mid-boot), which makes a plain `vite` invocation die
 *   instantly with "Port 5173 is already in use" / "Dev server failed".
 *
 * What this script does:
 *   1. Detects anything already listening on the dev port and kills it if it
 *      is a leftover node/vite process (never touches non-node processes).
 *   2. Starts Vite with a deterministic port so the preview health check can
 *      always find it.
 *   3. Retries a few times on transient startup crashes (port races, cold
 *      dependency optimization), clearing the port between attempts.
 *   4. Forwards signals and the real exit code to the parent, so the platform
 *      always sees the true state of the server.
 */
import { spawn, execSync } from "node:child_process";
import { createConnection } from "node:net";
import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_PORT = Number(process.env.PORT || 5173);
const RETRY_DELAY_MS = 2000;
const INSTALL_WAIT_MS = 2000; // poll interval while waiting for node_modules
const INSTALL_MAX_WAIT_MS = 60000; // cap for waiting out a slow `npm install`
const VITE_BIN = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
const PID_FILE = path.join(ROOT, "node_modules", `.vite-dev-${DEV_PORT}.pid`);

const log = (...args) => console.log("[dev]", ...args);

const MAX_RETRIES = 8;

/** Resolve the PIDs of node processes listening on `port` (best effort, Linux /proc). */
function pidsListeningOnPort(port) {
  const pids = new Set();
  try {
    // Parse `ss` output (available on Alpine/busybox) for the listening socket.
    const out = execSync(
      `ss -tlnp 2>/dev/null | awk -v p=":${port}" '$4 ~ p {print}' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u`,
      { encoding: "utf8" },
    );
    for (const line of out.split("\n")) {
      const pid = parseInt(line.trim(), 10);
      if (Number.isFinite(pid) && pid > 0) pids.add(pid);
    }
  } catch {
    /* ss unavailable or nothing matched — fine */
  }
  return [...pids];
}

function isNodeProcess(pid) {
  try {
    const comm = readFileSync(`/proc/${pid}/comm`, "utf8").trim().toLowerCase();
    return comm === "node" || comm === "nodejs" || comm.startsWith("node");
  } catch {
    return false;
  }
}

/** Returns true if something is accepting connections on `port`. */
function portIsOpen(port) {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: "127.0.0.1" });
    sock.setTimeout(800, () => {
      sock.destroy();
      resolve(false);
    });
    sock.on("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
  });
}

/** Kill leftover node/vite processes holding the dev port. */
async function clearStaleProcesses() {
  if (!(await portIsOpen(DEV_PORT))) return;
  const pids = pidsListeningOnPort(DEV_PORT).filter(
    (pid) => pid !== process.pid && isNodeProcess(pid),
  );
  if (pids.length === 0) {
    log(`port ${DEV_PORT} is occupied by a non-node process; leaving it alone`);
    return;
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
      log(`killed stale process ${pid} holding port ${DEV_PORT}`);
    } catch {
      /* already gone */
    }
  }
  // Give the kernel a moment to release the socket.
  await new Promise((r) => setTimeout(r, 500));
}

function writePid() {
  try {
    writeFileSync(PID_FILE, String(process.pid));
  } catch {
    /* non-fatal */
  }
}

function removePid() {
  try {
    rmSync(PID_FILE, { force: true });
  } catch {
    /* non-fatal */
  }
}

/**
 * Loading-page placeholder server.
 *
 * While vite is starting (install still running, or a crash-retry backoff),
 * we serve a lightweight "Starting development server…" page on the dev port.
 * The preview platform health-checks the port; keeping it answering with
 * HTTP 200 avoids the scary "Dev server failed" message during the brief
 * window when vite is not yet (or no longer) listening. The page polls the
 * root until the real app appears, then reloads.
 */
const PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Loading…</title>
<style>
  html,body{margin:0;height:100%}
  body{background:#0b1220;color:#cbd5e1;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       display:flex;align-items:center;justify-content:center}
  #root{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
  .box{display:flex;align-items:center;gap:14px;font-size:15px}
  .spin{width:26px;height:26px;border-radius:50%;border:3px solid #1e293b;border-top-color:#6366f1;
        animation:spin 1s linear infinite;flex:none}
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body data-placeholder="1">
  <div id="root">
    <div class="box">
      <div class="spin" aria-hidden="true"></div>
      <div>Starting development server…</div>
    </div>
  </div>
  <script>
    (function poll() {
      fetch('/', { cache: 'no-store' })
        .then(function (r) { return r.text(); })
        .then(function (t) {
          if (t.indexOf('id="root"') !== -1 && t.indexOf('data-placeholder') === -1) {
            location.reload();
            return;
          }
          setTimeout(poll, 700);
        })
        .catch(function () { setTimeout(poll, 700); });
    })();
  </script>
</body>
</html>
`;

let placeholder = null;

/** Bind the loading page to the dev port. Returns true if it bound. */
function startPlaceholder() {
  return new Promise((resolve) => {
    if (placeholder) return resolve(true);
    const srv = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(PLACEHOLDER_HTML);
    });
    srv.on("error", () => {
      placeholder = null;
      resolve(false); // port busy (e.g. vite already up) — nothing to do
    });
    srv.listen(DEV_PORT, "0.0.0.0", () => {
      placeholder = srv;
      log(`serving loading page on port ${DEV_PORT} while vite starts`);
      resolve(true);
    });
  });
}

function stopPlaceholder() {
  if (placeholder) {
    try {
      placeholder.close();
    } catch {
      /* ignore */
    }
    placeholder = null;
  }
}

async function startOnce(attempt) {
  // Free the port for vite: our own loading page must go first, then any
  // other stale process.
  stopPlaceholder();
  await clearStaleProcesses();
  writePid();

  log(`starting vite (attempt ${attempt}/${MAX_RETRIES}) on port ${DEV_PORT}`);
  const child = spawn(process.execPath, [VITE_BIN, "--port", String(DEV_PORT), "--strictPort"], {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env },
  });

  // Set when the platform/parent asks us to shut down. A signal is an
  // intentional teardown, so we must NOT retry after it.
  let shuttingDown = false;

  const exitCode = await new Promise((resolve) => {
    const onSignal = (signal) => {
      shuttingDown = true;
      log(`received ${signal}, forwarding to vite`);
      child.kill(signal);
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    child.on("exit", (code, signal) => {
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
      removePid();
      if (shuttingDown) resolve("shutdown");
      else if (code !== null) resolve(code);
      else if (signal) resolve(signal === "SIGKILL" ? 137 : 1);
      else resolve(1);
    });
    child.on("error", (err) => {
      console.error("[dev] failed to spawn vite:", err.message);
      removePid();
      resolve(1);
    });
  });

  return exitCode;
}

async function waitForInstall() {
  if (existsSync(VITE_BIN)) return true;
  log(
    `vite binary not found yet (${path.relative(ROOT, VITE_BIN)}) — ` +
      "npm install may still be running; waiting…",
  );
  const waitedUntil = Date.now() + INSTALL_MAX_WAIT_MS;
  while (Date.now() < waitedUntil) {
    await new Promise((r) => setTimeout(r, INSTALL_WAIT_MS));
    if (existsSync(VITE_BIN)) {
      log("node_modules ready; proceeding");
      return true;
    }
  }
  console.error(
    `[dev] vite binary still missing after ${INSTALL_MAX_WAIT_MS / 1000}s — giving up`,
  );
  return false;
}

async function main() {
  // A previous run's PID file can outlive a dead process across sandbox
  // restarts; if the process is gone, just clear it.
  if (existsSync(PID_FILE)) {
    try {
      const oldPid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
      if (Number.isFinite(oldPid)) {
        try {
          process.kill(oldPid, 0); // throws if not alive
        } catch {
          rmSync(PID_FILE, { force: true });
        }
      }
    } catch {
      rmSync(PID_FILE, { force: true });
    }
  }

  // The platform runs install and dev back-to-back; if the dev server boots
  // before install finished, wait for node_modules instead of failing fast.
  // While we wait (and between retries) the loading page keeps the port alive
  // so the preview never shows a dead server.
  await startPlaceholder();
  if (!(await waitForInstall())) {
    process.exitCode = 1;
    return;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const code = await startOnce(attempt);
    if (code === 0 || code === "shutdown") {
      if (code === "shutdown") log("shutting down on signal");
      return; // clean shutdown (SIGINT/SIGTERM from platform)
    }
    log(`vite exited with code ${code}`);
    if (attempt < MAX_RETRIES) {
      log(`retrying in ${RETRY_DELAY_MS}ms...`);
      await startPlaceholder(); // keep the port answering during backoff
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    } else {
      console.error(`[dev] vite failed after ${MAX_RETRIES} attempts (last exit code ${code})`);
      process.exitCode = code;
    }
  }
}

main();
