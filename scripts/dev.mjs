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
import { readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_PORT = Number(process.env.PORT || 5173);
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const VITE_BIN = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
const PID_FILE = path.join(ROOT, "node_modules", ".vite-dev.pid");

const log = (...args) => console.log("[dev]", ...args);

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
  const pids = pidsListeningOnPort(DEV_PORT).filter(isNodeProcess);
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

async function startOnce(attempt) {
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

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const code = await startOnce(attempt);
    if (code === 0 || code === "shutdown") {
      if (code === "shutdown") log("shutting down on signal");
      return; // clean shutdown (SIGINT/SIGTERM from platform)
    }
    log(`vite exited with code ${code}`);
    if (attempt < MAX_RETRIES) {
      log(`retrying in ${RETRY_DELAY_MS}ms...`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    } else {
      console.error(`[dev] vite failed after ${MAX_RETRIES} attempts (last exit code ${code})`);
      process.exitCode = code;
    }
  }
}

main();
