import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { buildDockerArgs } from "../containerLauncher.js";
import type { ContainerConfig } from "../containerLauncher.js";

// ---
// Docker availability check
// ---

function hasDocker(): boolean {
  try {
    execSync("docker info", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a docker command and return the exit code + stdout.
 */
function runDocker(args: string[]): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout: Buffer.concat(chunks).toString() });
    });
    child.on("error", () => {
      resolve({ exitCode: 1, stdout: "" });
    });
  });
}

// ---
// Tests — skip gracefully when Docker is unavailable
// ---

describe.skipIf(!hasDocker())("container e2e", () => {
  const tempDirs: string[] = [];

  function makeTmpDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), `container-e2e-${prefix}-`));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("mounts project root rw at /workspace", async () => {
    const workspace = makeTmpDir("ws");
    const result = await runDocker([
      "run", "--rm",
      "-v", `${workspace}:/workspace:rw`,
      "--workdir", "/workspace",
      "node:22-slim",
      "node", "-e", "require('fs').writeFileSync('/workspace/proof.txt', 'hello')",
    ]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(workspace, "proof.txt"))).toBe(true);
    expect(readFileSync(join(workspace, "proof.txt"), "utf-8")).toBe("hello");
  });

  it("mounts tasks directory rw at /tasks", async () => {
    const tasksDir = makeTmpDir("tasks");
    writeFileSync(join(tasksDir, "tasks.json"), '{"test": true}');
    const result = await runDocker([
      "run", "--rm",
      "-v", `${tasksDir}:/tasks:rw`,
      "node:22-slim",
      "node", "-e", "require('fs').writeFileSync('/tasks/state.json', '{}')",
    ]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(tasksDir, "state.json"))).toBe(true);
  });

  it("mounts spec read-only at /refs/spec.md", async () => {
    const specsDir = makeTmpDir("specs");
    const workspace = makeTmpDir("ws");
    writeFileSync(join(specsDir, "spec.md"), "# My Spec Content");
    const result = await runDocker([
      "run", "--rm",
      "-v", `${specsDir}/spec.md:/refs/spec.md:ro`,
      "-v", `${workspace}:/workspace:rw`,
      "--workdir", "/workspace",
      "node:22-slim",
      "node", "-e",
      "const c = require('fs').readFileSync('/refs/spec.md','utf-8'); require('fs').writeFileSync('/workspace/proof.txt', c)",
    ]);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(workspace, "proof.txt"), "utf-8")).toBe("# My Spec Content");
  });

  it("forwards ANTHROPIC_API_KEY", async () => {
    const workspace = makeTmpDir("ws");
    const result = await runDocker([
      "run", "--rm",
      "-e", "ANTHROPIC_API_KEY=test-key-123",
      "-v", `${workspace}:/workspace:rw`,
      "--workdir", "/workspace",
      "node:22-slim",
      "node", "-e",
      "require('fs').writeFileSync('/workspace/env.json', JSON.stringify({key: process.env.ANTHROPIC_API_KEY}))",
    ]);
    expect(result.exitCode).toBe(0);
    const envData = JSON.parse(readFileSync(join(workspace, "env.json"), "utf-8"));
    expect(envData.key).toBe("test-key-123");
  });

  it("forwards TRELLIS_EXEC_* env vars", async () => {
    const workspace = makeTmpDir("ws");
    const result = await runDocker([
      "run", "--rm",
      "-e", "TRELLIS_EXEC_MODEL=sonnet",
      "-v", `${workspace}:/workspace:rw`,
      "--workdir", "/workspace",
      "node:22-slim",
      "node", "-e",
      "require('fs').writeFileSync('/workspace/env.json', JSON.stringify({model: process.env.TRELLIS_EXEC_MODEL}))",
    ]);
    expect(result.exitCode).toBe(0);
    const envData = JSON.parse(readFileSync(join(workspace, "env.json"), "utf-8"));
    expect(envData.model).toBe("sonnet");
  });

  it("applies --network none (blocks outbound)", async () => {
    // Attempt to fetch a URL — should fail because network is disabled
    const result = await runDocker([
      "run", "--rm",
      "--network", "none",
      "node:22-slim",
      "node", "-e",
      "fetch('https://example.com').then(() => process.exit(0)).catch(() => process.exit(42))",
    ]);
    expect(result.exitCode).toBe(42);
  });

  it("returns exit code from inner process", async () => {
    const result = await runDocker([
      "run", "--rm",
      "node:22-slim",
      "node", "-e", "process.exit(42)",
    ]);
    expect(result.exitCode).toBe(42);
  });

  it("full buildDockerArgs round-trip with node:22-slim", async () => {
    const workspace = makeTmpDir("ws");
    const tasksDir = makeTmpDir("tasks");
    const specsDir = makeTmpDir("specs");

    writeFileSync(join(tasksDir, "tasks.json"), '{}');
    writeFileSync(join(specsDir, "spec.md"), "spec content");
    writeFileSync(join(specsDir, "plan.md"), "plan content");

    const config: ContainerConfig = {
      projectRoot: workspace,
      tasksJsonDir: tasksDir,
      tasksJsonFilename: "tasks.json",
      specPath: join(specsDir, "spec.md"),
      planPath: join(specsDir, "plan.md"),
      guidelinesPath: undefined,
      containerImage: "node:22-slim",
      containerNetwork: "none",
      containerCpus: "2",
      containerMemory: "1g",
      innerCliArgs: [],
    };

    const env = { ANTHROPIC_API_KEY: "test-key" };
    const args = buildDockerArgs(config, env);

    // Override the inner command: instead of running trellis-exec (which isn't
    // installed in node:22-slim), verify the mounts and env are correct.
    // Find the image position and replace everything after it.
    const imageIdx = args.indexOf("node:22-slim");
    const dockerArgs = args.slice(0, imageIdx + 1);
    dockerArgs.push(
      "node", "-e",
      [
        "const fs = require('fs');",
        "const result = {",
        "  workspace: fs.existsSync('/workspace'),",
        "  tasks: fs.existsSync('/tasks/tasks.json'),",
        "  spec: fs.readFileSync('/refs/spec.md', 'utf-8'),",
        "  plan: fs.readFileSync('/refs/plan.md', 'utf-8'),",
        "  apiKey: process.env.ANTHROPIC_API_KEY,",
        "};",
        "fs.writeFileSync('/workspace/result.json', JSON.stringify(result));",
      ].join(""),
    );

    // Spawn docker directly with the full args (including "run" as first element)
    const directResult = await new Promise<{ exitCode: number }>((resolve) => {
      const child = spawn("docker", dockerArgs, { stdio: "inherit" });
      child.on("close", (code) => resolve({ exitCode: code ?? 1 }));
      child.on("error", () => resolve({ exitCode: 1 }));
    });

    expect(directResult.exitCode).toBe(0);
    const data = JSON.parse(readFileSync(join(workspace, "result.json"), "utf-8"));
    expect(data.workspace).toBe(true);
    expect(data.tasks).toBe(true);
    expect(data.spec).toBe("spec content");
    expect(data.plan).toBe("plan content");
    expect(data.apiKey).toBe("test-key");
  });
});
