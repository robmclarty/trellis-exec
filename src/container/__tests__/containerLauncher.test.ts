import { describe, it, expect } from "vitest";
import {
  buildDockerArgs,
  buildInnerCliArgs,
  checkDockerAvailable,
  buildContainerConfig,
  buildTargetFromImage,
} from "../containerLauncher.js";
import type { ContainerConfig } from "../containerLauncher.js";

// ---
// Fixtures
// ---

function makeConfig(overrides?: Partial<ContainerConfig>): ContainerConfig {
  return {
    projectRoot: "/home/user/myproject",
    tasksJsonDir: "/home/user/specs",
    tasksJsonFilename: "tasks.json",
    specPath: "/home/user/specs/spec.md",
    planPath: "/home/user/specs/plan.md",
    guidelinesPath: undefined,
    containerImage: "trellis-exec:slim",
    containerNetwork: "none",
    containerCpus: "4",
    containerMemory: "8g",
    innerCliArgs: [],
    ...overrides,
  };
}

const EMPTY_ENV: Record<string, string | undefined> = {};

// ---
// buildDockerArgs
// ---

describe("buildDockerArgs", () => {
  it("produces correct base args", () => {
    const args = buildDockerArgs(makeConfig(), EMPTY_ENV);
    expect(args[0]).toBe("run");
    expect(args[1]).toBe("--rm");
    expect(args).toContain("--network");
    expect(args[args.indexOf("--network") + 1]).toBe("none");
    expect(args).toContain("--cpus");
    expect(args[args.indexOf("--cpus") + 1]).toBe("4");
    expect(args).toContain("--memory");
    expect(args[args.indexOf("--memory") + 1]).toBe("8g");
    expect(args).toContain("--pids-limit");
    expect(args[args.indexOf("--pids-limit") + 1]).toBe("512");
  });

  it("mounts projectRoot rw at /workspace", () => {
    const args = buildDockerArgs(makeConfig(), EMPTY_ENV);
    expect(args).toContain("-v");
    expect(args).toContain("/home/user/myproject:/workspace:rw");
  });

  it("mounts tasksJsonDir rw at /tasks", () => {
    const args = buildDockerArgs(makeConfig(), EMPTY_ENV);
    expect(args).toContain("/home/user/specs:/tasks:rw");
  });

  it("mounts spec ro at /refs/spec.md", () => {
    const args = buildDockerArgs(makeConfig(), EMPTY_ENV);
    expect(args).toContain("/home/user/specs/spec.md:/refs/spec.md:ro");
  });

  it("mounts plan ro at /refs/plan.md", () => {
    const args = buildDockerArgs(makeConfig(), EMPTY_ENV);
    expect(args).toContain("/home/user/specs/plan.md:/refs/plan.md:ro");
  });

  it("includes guidelines mount when present", () => {
    const config = makeConfig({ guidelinesPath: "/home/user/specs/guidelines.md" });
    const args = buildDockerArgs(config, EMPTY_ENV);
    expect(args).toContain("/home/user/specs/guidelines.md:/refs/guidelines.md:ro");
  });

  it("omits guidelines mount when undefined", () => {
    const args = buildDockerArgs(makeConfig(), EMPTY_ENV);
    const guidelinesMount = args.find((a) => a.includes("/refs/guidelines.md"));
    expect(guidelinesMount).toBeUndefined();
  });

  it("forwards ANTHROPIC_API_KEY from env", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-123" };
    const args = buildDockerArgs(makeConfig(), env);
    const eIdx = args.indexOf("ANTHROPIC_API_KEY");
    expect(eIdx).toBeGreaterThan(0);
    expect(args[eIdx - 1]).toBe("-e");
  });

  it("forwards TRELLIS_EXEC_* env vars", () => {
    const env = {
      TRELLIS_EXEC_MODEL: "opus",
      TRELLIS_EXEC_VERBOSE: "true",
      OTHER_VAR: "nope",
    };
    const args = buildDockerArgs(makeConfig(), env);
    expect(args).toContain("TRELLIS_EXEC_MODEL");
    expect(args).toContain("TRELLIS_EXEC_VERBOSE");
    expect(args).not.toContain("OTHER_VAR");
  });

  it("does not forward ANTHROPIC_API_KEY when absent from env", () => {
    const args = buildDockerArgs(makeConfig(), EMPTY_ENV);
    expect(args).not.toContain("ANTHROPIC_API_KEY");
  });

  it("uses custom resource limits", () => {
    const config = makeConfig({ containerCpus: "8", containerMemory: "16g" });
    const args = buildDockerArgs(config, EMPTY_ENV);
    expect(args[args.indexOf("--cpus") + 1]).toBe("8");
    expect(args[args.indexOf("--memory") + 1]).toBe("16g");
  });

  it("uses custom network mode", () => {
    const config = makeConfig({ containerNetwork: "host" });
    const args = buildDockerArgs(config, EMPTY_ENV);
    expect(args[args.indexOf("--network") + 1]).toBe("host");
  });

  it("uses custom image", () => {
    const config = makeConfig({ containerImage: "my-custom:latest" });
    const args = buildDockerArgs(config, EMPTY_ENV);
    expect(args).toContain("my-custom:latest");
  });

  it("includes inner command with --container-inner --headless", () => {
    const args = buildDockerArgs(makeConfig(), EMPTY_ENV);
    // Find the image in the args — everything after it is the inner command
    const imageIdx = args.indexOf("trellis-exec:slim");
    const innerCmd = args.slice(imageIdx + 1);
    expect(innerCmd[0]).toBe("trellis-exec");
    expect(innerCmd[1]).toBe("run");
    expect(innerCmd[2]).toBe("/tasks/tasks.json");
    expect(innerCmd).toContain("--container-inner");
    expect(innerCmd).toContain("--headless");
    expect(innerCmd).toContain("--project-root");
    expect(innerCmd[innerCmd.indexOf("--project-root") + 1]).toBe("/workspace");
    expect(innerCmd).toContain("--spec");
    expect(innerCmd[innerCmd.indexOf("--spec") + 1]).toBe("/refs/spec.md");
    expect(innerCmd).toContain("--plan");
    expect(innerCmd[innerCmd.indexOf("--plan") + 1]).toBe("/refs/plan.md");
  });

  it("includes --guidelines in inner command when guidelines present", () => {
    const config = makeConfig({ guidelinesPath: "/home/user/specs/guidelines.md" });
    const args = buildDockerArgs(config, EMPTY_ENV);
    const imageIdx = args.indexOf("trellis-exec:slim");
    const innerCmd = args.slice(imageIdx + 1);
    expect(innerCmd).toContain("--guidelines");
    expect(innerCmd[innerCmd.indexOf("--guidelines") + 1]).toBe("/refs/guidelines.md");
  });

  it("omits --guidelines in inner command when not present", () => {
    const args = buildDockerArgs(makeConfig(), EMPTY_ENV);
    const imageIdx = args.indexOf("trellis-exec:slim");
    const innerCmd = args.slice(imageIdx + 1);
    expect(innerCmd).not.toContain("--guidelines");
  });

  it("forwards innerCliArgs after fixed args", () => {
    const config = makeConfig({ innerCliArgs: ["--model", "sonnet", "--verbose"] });
    const args = buildDockerArgs(config, EMPTY_ENV);
    const imageIdx = args.indexOf("trellis-exec:slim");
    const innerCmd = args.slice(imageIdx + 1);
    expect(innerCmd).toContain("--model");
    expect(innerCmd).toContain("sonnet");
    expect(innerCmd).toContain("--verbose");
  });
});

// ---
// buildInnerCliArgs
// ---

describe("buildInnerCliArgs", () => {
  it("forwards string flags", () => {
    const result = buildInnerCliArgs({
      model: "opus",
      "judge-model": "sonnet",
      "max-retries": "3",
    });
    expect(result).toEqual([
      "--model", "opus",
      "--max-retries", "3",
      "--judge-model", "sonnet",
    ]);
  });

  it("forwards boolean flags", () => {
    const result = buildInnerCliArgs({
      verbose: true,
      "long-run": true,
    });
    expect(result).toContain("--verbose");
    expect(result).toContain("--long-run");
  });

  it("omits container-related flags", () => {
    const result = buildInnerCliArgs({
      container: true,
      "container-inner": true,
      "container-image": "foo:bar",
      "container-network": "host",
      "container-cpus": "8",
      "container-memory": "16g",
    });
    expect(result).toEqual([]);
  });

  it("omits path-override flags", () => {
    const result = buildInnerCliArgs({
      "project-root": "/foo",
      spec: "/bar/spec.md",
      plan: "/bar/plan.md",
      guidelines: "/bar/guidelines.md",
    });
    expect(result).toEqual([]);
  });

  it("omits unsafe and headless flags", () => {
    const result = buildInnerCliArgs({
      unsafe: true,
      headless: true,
      "dry-run": true,
    });
    expect(result).toEqual([]);
  });

  it("returns empty array when no values present", () => {
    const result = buildInnerCliArgs({});
    expect(result).toEqual([]);
  });

  it("handles mixed forwarded and non-forwarded flags", () => {
    const result = buildInnerCliArgs({
      model: "opus",
      container: true,
      verbose: true,
      unsafe: true,
      "max-run-budget": "25.00",
    });
    expect(result).toContain("--model");
    expect(result).toContain("opus");
    expect(result).toContain("--verbose");
    expect(result).toContain("--max-run-budget");
    expect(result).toContain("25.00");
    expect(result).not.toContain("--container");
    expect(result).not.toContain("--unsafe");
  });
});

// ---
// buildContainerConfig
// ---

describe("buildContainerConfig", () => {
  it("extracts dir and basename from tasksJsonPath", () => {
    const config = buildContainerConfig({
      projectRoot: "/project",
      tasksJsonPath: "/specs/tasks.json",
      specPath: "/specs/spec.md",
      planPath: "/specs/plan.md",
      containerImage: "trellis-exec:slim",
      containerNetwork: "none",
      containerCpus: "4",
      containerMemory: "8g",
      innerCliArgs: [],
    });
    expect(config.tasksJsonDir).toBe("/specs");
    expect(config.tasksJsonFilename).toBe("tasks.json");
  });
});

// ---
// checkDockerAvailable
// ---

describe("checkDockerAvailable", () => {
  it("returns a boolean", () => {
    const result = checkDockerAvailable();
    expect(typeof result).toBe("boolean");
  });
});

// ---
// buildTargetFromImage
// ---

describe("buildTargetFromImage", () => {
  it("returns 'slim' for trellis-exec:slim", () => {
    expect(buildTargetFromImage("trellis-exec:slim")).toBe("slim");
  });

  it("returns 'browser' for trellis-exec:browser", () => {
    expect(buildTargetFromImage("trellis-exec:browser")).toBe("browser");
  });

  it("returns undefined for custom images", () => {
    expect(buildTargetFromImage("my-org/trellis:custom")).toBeUndefined();
  });

  it("returns undefined for images without a tag", () => {
    expect(buildTargetFromImage("trellis-exec")).toBeUndefined();
  });

  it("returns 'slim' regardless of registry prefix", () => {
    expect(buildTargetFromImage("ghcr.io/foo:slim")).toBe("slim");
  });
});
