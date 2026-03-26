import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_READY_TIMEOUT = 60_000;
const POLL_INTERVAL = 1_000;
const SHUTDOWN_GRACE_MS = 5_000;
const MAX_OUTPUT_BUFFER = 64 * 1024; // 64KB

// Common port patterns in server output
const PORT_PATTERNS = [
  /(?:listening|running|started)\s+(?:on|at)\s+(?:https?:\/\/)?(?:localhost|0\.0\.0\.0|127\.0\.0\.1)[:\s]+(\d+)/i,
  /https?:\/\/localhost:(\d+)/i,
  /port\s+(\d+)/i,
  /:(\d{4,5})\b/,
];

const COMMON_PORTS = [3000, 5173, 8080, 4000, 8000];

export type DevServerConfig = {
  command: string;
  cwd: string;
  readyTimeout?: number;
};

export type DevServerHandle = {
  url: string;
  port: number;
  stop(): Promise<void>;
};

/**
 * Attempts to detect a dev server start command from the project.
 * Language-agnostic: checks Node, Python, Ruby, Go, Docker patterns.
 * Returns null if no dev server can be identified.
 */
export function detectDevServerCommand(projectRoot: string): string | null {
  // 1. package.json scripts.dev or scripts.start
  const pkgPath = join(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (typeof pkg?.scripts?.dev === "string" && pkg.scripts.dev.length > 0) {
        return "npm run dev";
      }
      if (typeof pkg?.scripts?.start === "string" && pkg.scripts.start.length > 0) {
        return "npm start";
      }
    } catch {
      // ignore parse errors
    }
  }

  // 2. Procfile with web entry
  const procfilePath = join(projectRoot, "Procfile");
  if (existsSync(procfilePath)) {
    try {
      const content = readFileSync(procfilePath, "utf-8");
      const webLine = content.split("\n").find((line) => /^web\s*:/.test(line));
      if (webLine) {
        return webLine.replace(/^web\s*:\s*/, "").trim();
      }
    } catch {
      // ignore
    }
  }

  // 3. Python (Django / Flask / FastAPI)
  if (existsSync(join(projectRoot, "manage.py"))) {
    return "python manage.py runserver";
  }

  // 4. Ruby on Rails
  if (
    existsSync(join(projectRoot, "Gemfile")) &&
    existsSync(join(projectRoot, "bin", "rails"))
  ) {
    return "bin/rails server";
  }

  // 5. Go
  if (existsSync(join(projectRoot, "main.go"))) {
    return "go run .";
  }

  // 6. Docker Compose
  for (const name of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
    if (existsSync(join(projectRoot, name))) {
      return "docker compose up";
    }
  }

  return null;
}

/**
 * Starts a dev server process and waits until it's ready to accept connections.
 * Detects the port from stdout/stderr or tries common ports.
 */
export async function startDevServer(config: DevServerConfig): Promise<DevServerHandle> {
  const timeout = config.readyTimeout ?? DEFAULT_READY_TIMEOUT;

  const child = spawn(config.command, {
    shell: true,
    cwd: config.cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let outputBuffer = "";
  let detectedPort: number | null = null;
  let processExited = false;
  let exitError: string | null = null;

  const appendOutput = (chunk: Buffer) => {
    const text = chunk.toString();
    // Only buffer up to MAX_OUTPUT_BUFFER to prevent memory issues
    if (outputBuffer.length < MAX_OUTPUT_BUFFER) {
      outputBuffer += text.slice(0, MAX_OUTPUT_BUFFER - outputBuffer.length);
    }

    // Try to detect port from output
    if (detectedPort === null) {
      for (const pattern of PORT_PATTERNS) {
        const match = text.match(pattern);
        if (match?.[1]) {
          const port = parseInt(match[1], 10);
          if (port > 0 && port < 65536) {
            detectedPort = port;
            break;
          }
        }
      }
    }
  };

  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendOutput);

  child.on("exit", (code) => {
    processExited = true;
    if (code !== 0 && code !== null) {
      exitError = `Dev server exited with code ${code}: ${outputBuffer.slice(0, 500)}`;
    }
  });

  // Wait for the server to be ready
  const port = await waitForReady(child, () => detectedPort, () => processExited, () => exitError, timeout);

  const url = `http://localhost:${port}`;

  return {
    url,
    port,
    stop: () => stopProcess(child),
  };
}

async function waitForReady(
  child: ChildProcess,
  getDetectedPort: () => number | null,
  hasExited: () => boolean,
  getExitError: () => string | null,
  timeout: number,
): Promise<number> {
  const deadline = Date.now() + timeout;

  // First, try to detect port from output (give it a few seconds)
  const portDetectionDeadline = Math.min(Date.now() + 10_000, deadline);
  while (Date.now() < portDetectionDeadline) {
    if (hasExited()) {
      throw new Error(getExitError() ?? "Dev server process exited before becoming ready");
    }
    const port = getDetectedPort();
    if (port !== null) {
      // Port detected, now poll until ready
      return await pollUntilReady(port, deadline, child, hasExited, getExitError);
    }
    await sleep(500);
  }

  // No port detected from output — try common ports
  for (const port of COMMON_PORTS) {
    if (Date.now() >= deadline) break;
    if (hasExited()) {
      throw new Error(getExitError() ?? "Dev server process exited before becoming ready");
    }
    if (await isPortResponding(port)) {
      return port;
    }
  }

  // Still no luck — keep polling common ports until timeout
  while (Date.now() < deadline) {
    if (hasExited()) {
      throw new Error(getExitError() ?? "Dev server process exited before becoming ready");
    }
    const port = getDetectedPort();
    if (port !== null) {
      return await pollUntilReady(port, deadline, child, hasExited, getExitError);
    }
    for (const p of COMMON_PORTS) {
      if (await isPortResponding(p)) return p;
    }
    await sleep(POLL_INTERVAL);
  }

  // Timeout — kill the process
  await stopProcess(child);
  throw new Error(`Dev server did not become ready within ${timeout}ms`);
}

async function pollUntilReady(
  port: number,
  deadline: number,
  child: ChildProcess,
  hasExited: () => boolean,
  getExitError: () => string | null,
): Promise<number> {
  while (Date.now() < deadline) {
    if (hasExited()) {
      throw new Error(getExitError() ?? "Dev server process exited before becoming ready");
    }
    if (await isPortResponding(port)) {
      return port;
    }
    await sleep(POLL_INTERVAL);
  }
  await stopProcess(child);
  throw new Error(`Dev server detected on port ${port} but did not respond within timeout`);
}

async function isPortResponding(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    const res = await fetch(`http://localhost:${port}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    // Any HTTP response (even 4xx) means the server is up
    return res.status < 500;
  } catch {
    return false;
  }
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.killed || child.exitCode !== null) return;

  child.kill("SIGTERM");

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (!child.killed && child.exitCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, SHUTDOWN_GRACE_MS);

    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
