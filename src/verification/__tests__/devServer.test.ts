import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectDevServerCommand, startDevServer, type DevServerHandle } from "../devServer.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "trellis-devsrv-"));
}

// --- detectDevServerCommand (unit tests) --------------------------------

describe("detectDevServerCommand", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = makeTempDir();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for an empty directory", () => {
    const emptyDir = makeTempDir();
    try {
      expect(detectDevServerCommand(emptyDir)).toBeNull();
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('returns "npm run dev" when package.json has scripts.dev', () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ scripts: { dev: "vite" } }),
      );
      expect(detectDevServerCommand(dir)).toBe("npm run dev");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns "npm start" when package.json has scripts.start but no scripts.dev', () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ scripts: { start: "node server.js" } }),
      );
      expect(detectDevServerCommand(dir)).toBe("npm start");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers scripts.dev over scripts.start", () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ scripts: { dev: "vite", start: "node server.js" } }),
      );
      expect(detectDevServerCommand(dir)).toBe("npm run dev");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns "python manage.py runserver" when manage.py exists', () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, "manage.py"), "");
      expect(detectDevServerCommand(dir)).toBe("python manage.py runserver");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns "bin/rails server" when Gemfile and bin/rails exist', () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, "Gemfile"), "");
      mkdirSync(join(dir, "bin"), { recursive: true });
      writeFileSync(join(dir, "bin", "rails"), "");
      expect(detectDevServerCommand(dir)).toBe("bin/rails server");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns "go run ." when main.go exists', () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, "main.go"), "");
      expect(detectDevServerCommand(dir)).toBe("go run .");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns "docker compose up" for docker-compose.yml', () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, "docker-compose.yml"), "");
      expect(detectDevServerCommand(dir)).toBe("docker compose up");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles Procfile with web entry", () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, "Procfile"), "web: gunicorn app:app\n");
      expect(detectDevServerCommand(dir)).toBe("gunicorn app:app");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- startDevServer (integration tests) ---------------------------------

describe("startDevServer", () => {
  let handle: DevServerHandle | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = null;
    }
  });

  it("starts a server and detects the port", async () => {
    const serverScript = `
      const http = require('http');
      const s = http.createServer((_, res) => { res.writeHead(200); res.end('ok'); });
      s.listen(0, () => console.log('listening on http://localhost:' + s.address().port));
    `;

    handle = await startDevServer({
      command: `node -e "${serverScript.replace(/\n/g, " ")}"`,
      cwd: tmpdir(),
      readyTimeout: 10_000,
    });

    expect(handle.port).toBeGreaterThan(0);
    expect(handle.url).toContain(`localhost:${handle.port}`);

    // Verify the server actually responds
    const res = await fetch(handle.url);
    expect(res.ok).toBe(true);
  });

  it("throws when the process exits immediately", async () => {
    await expect(
      startDevServer({
        command: "exit 1",
        cwd: tmpdir(),
        readyTimeout: 5_000,
      }),
    ).rejects.toThrow();
  });
});

// --- startDevServer edge cases ------------------------------------------------

describe("startDevServer edge cases", () => {
  let handle: DevServerHandle | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = null;
    }
  });

  it("rejects with exit code in error message when process exits with non-zero code", async () => {
    await expect(
      startDevServer({
        command: "exit 42",
        cwd: tmpdir(),
        readyTimeout: 5_000,
      }),
    ).rejects.toThrow(/exited/);
  });

  it("rejects when command is not found", async () => {
    await expect(
      startDevServer({
        command: "nonexistent_command_xyz_123",
        cwd: tmpdir(),
        readyTimeout: 5_000,
      }),
    ).rejects.toThrow();
  });

  it("times out when server never outputs a port and binds to no common port", async () => {
    // A process that stays alive but never listens on any port
    await expect(
      startDevServer({
        command: "sleep 60",
        cwd: tmpdir(),
        readyTimeout: 1_000,
      }),
    ).rejects.toThrow(/did not become ready/);
  }, 15_000);
});
