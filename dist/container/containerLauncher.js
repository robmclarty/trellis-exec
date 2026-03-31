import { spawn, execSync } from "node:child_process";
import { basename, dirname } from "node:path";
// ---
// Pure functions
// ---
/**
 * Builds the `docker run` argument list from a ContainerConfig.
 * Takes `env` as a parameter (not `process.env`) for testability.
 */
export function buildDockerArgs(config, env) {
    const args = ["run", "--rm"];
    // Bind mounts
    args.push("-v", `${config.projectRoot}:/workspace:rw`);
    args.push("-v", `${config.tasksJsonDir}:/tasks:rw`);
    args.push("-v", `${config.specPath}:/refs/spec.md:ro`);
    args.push("-v", `${config.planPath}:/refs/plan.md:ro`);
    if (config.guidelinesPath !== undefined) {
        args.push("-v", `${config.guidelinesPath}:/refs/guidelines.md:ro`);
    }
    // Auth mounts (volume, token, plugins, settings)
    if (config.authMounts !== undefined) {
        args.push(...config.authMounts);
    }
    // Environment variables
    if (env.ANTHROPIC_API_KEY !== undefined) {
        args.push("-e", "ANTHROPIC_API_KEY");
    }
    for (const key of Object.keys(env)) {
        if (key.startsWith("TRELLIS_EXEC_")) {
            args.push("-e", key);
        }
    }
    // Resource limits
    args.push("--cpus", config.containerCpus);
    args.push("--memory", config.containerMemory);
    args.push("--pids-limit", "512");
    // Network
    args.push("--network", config.containerNetwork);
    // Workdir
    args.push("--workdir", "/workspace");
    // Image
    args.push(config.containerImage);
    // Inner command
    const innerCmd = [
        "run",
        `/tasks/${config.tasksJsonFilename}`,
        "--container-inner",
        "--headless",
        "--project-root", "/workspace",
        "--spec", "/refs/spec.md",
        "--plan", "/refs/plan.md",
    ];
    if (config.guidelinesPath !== undefined) {
        innerCmd.push("--guidelines", "/refs/guidelines.md");
    }
    innerCmd.push(...config.innerCliArgs);
    args.push(...innerCmd);
    return args;
}
// Flags that should be forwarded from the outer CLI to the inner container process.
const FORWARDED_STRING_FLAGS = [
    "model",
    "max-retries",
    "concurrency",
    "check",
    "judge",
    "judge-model",
    "timeout",
    "dev-server",
    "browser-test-retries",
    "max-phase-budget",
    "max-run-budget",
    "max-run-tokens",
    "phase",
];
const FORWARDED_BOOLEAN_FLAGS = [
    "long-run",
    "verbose",
    "save-e2e-tests",
    "resume",
];
/**
 * Extracts CLI flags that should be forwarded to the inner container process.
 * Omits flags that are overridden by container paths or that control
 * the container itself.
 */
export function buildInnerCliArgs(values) {
    const args = [];
    for (const flag of FORWARDED_STRING_FLAGS) {
        const val = values[flag];
        if (val !== undefined && typeof val === "string") {
            args.push(`--${flag}`, val);
        }
    }
    for (const flag of FORWARDED_BOOLEAN_FLAGS) {
        const val = values[flag];
        if (val === true) {
            args.push(`--${flag}`);
        }
    }
    return args;
}
// ---
// Docker availability check
// ---
export function checkDockerAvailable() {
    try {
        execSync("docker info", { stdio: "pipe" });
        return true;
    }
    catch {
        return false;
    }
}
// ---
// Image existence check
// ---
export function checkImageExists(image) {
    try {
        execSync(`docker image inspect ${image}`, { stdio: "pipe" });
        return true;
    }
    catch {
        return false;
    }
}
// ---
// Image build
// ---
/**
 * Derives the Docker build target from an image tag.
 * "trellis-exec:slim" → "slim", "trellis-exec:browser" → "browser".
 * Returns undefined for unrecognised or custom images.
 */
export function buildTargetFromImage(image) {
    const KNOWN_TARGETS = ["slim", "browser"];
    const tag = image.split(":")[1];
    if (tag !== undefined && KNOWN_TARGETS.includes(tag)) {
        return tag;
    }
    return undefined;
}
/**
 * Builds the Docker image synchronously.
 * Throws if the build fails.
 */
export function buildImage(image, target, dockerfileDir) {
    execSync(`docker build --target ${target} -t ${image} -f ${dockerfileDir}/docker/Dockerfile ${dockerfileDir}`, { stdio: "inherit" });
}
// ---
// Container launcher
// ---
/**
 * Launches trellis-exec inside a Docker container and returns the exit code.
 * The host process delegates entirely to the container; stdio is inherited
 * so output streams through to the terminal.
 */
export function launchInContainer(config) {
    const args = buildDockerArgs(config, process.env);
    return new Promise((resolve) => {
        const child = spawn("docker", args, {
            stdio: "inherit",
        });
        child.on("close", (code) => {
            resolve(code ?? 1);
        });
        child.on("error", () => {
            resolve(1);
        });
    });
}
/**
 * Convenience: build a ContainerConfig from resolved RunContext fields
 * and raw CLI values.
 */
export function buildContainerConfig(opts) {
    return {
        projectRoot: opts.projectRoot,
        tasksJsonDir: dirname(opts.tasksJsonPath),
        tasksJsonFilename: basename(opts.tasksJsonPath),
        specPath: opts.specPath,
        planPath: opts.planPath,
        guidelinesPath: opts.guidelinesPath,
        containerImage: opts.containerImage,
        containerNetwork: opts.containerNetwork,
        containerCpus: opts.containerCpus,
        containerMemory: opts.containerMemory,
        innerCliArgs: opts.innerCliArgs,
        authMounts: opts.authMounts,
    };
}
//# sourceMappingURL=containerLauncher.js.map