import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getChangedFiles } from "../git.js";
// ---------------------------------------------------------------------------
// Test auto-detection
// ---------------------------------------------------------------------------
const TEST_FILE_PATTERNS = [
    // JS/TS
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /__tests__\//,
    /\.test\.\w+$/,
    // Go
    /_test\.go$/,
    // Python
    /test_[^/]+\.py$/,
    /[^/]+_test\.py$/,
    // Ruby
    /_spec\.rb$/,
    // Elixir
    /_test\.exs$/,
    // Generic test directories
    /(?:^|\/)tests?\//,
    /(?:^|\/)spec\//,
];
/**
 * Returns true if any newly added files look like test files.
 */
export function hasNewTestFiles(projectRoot, startSha) {
    const changed = getChangedFiles(projectRoot, startSha);
    return changed.some((f) => (f.status === "A" || f.status === "?" || f.status === "M") &&
        TEST_FILE_PATTERNS.some((re) => re.test(f.path)));
}
/**
 * Attempts to detect a test command from the project.
 * Returns null if no test runner can be identified.
 */
export function detectTestCommand(projectRoot) {
    // ---
    // Node.js / JavaScript / TypeScript
    // ---
    // Check package.json test script
    const pkgPath = join(projectRoot, "package.json");
    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
            const testScript = pkg?.scripts?.test;
            if (typeof testScript === "string" &&
                testScript.length > 0 &&
                !testScript.includes("no test specified")) {
                return "npm test";
            }
        }
        catch {
            // ignore parse errors
        }
    }
    // Check for common JS test runner configs
    const jsConfigs = [
        { file: "vitest.config.ts", command: "npx vitest run" },
        { file: "vitest.config.js", command: "npx vitest run" },
        { file: "vitest.config.mts", command: "npx vitest run" },
        { file: "jest.config.ts", command: "npx jest" },
        { file: "jest.config.js", command: "npx jest" },
        { file: "jest.config.cjs", command: "npx jest" },
        { file: "jest.config.mjs", command: "npx jest" },
    ];
    for (const { file, command } of jsConfigs) {
        if (existsSync(join(projectRoot, file))) {
            return command;
        }
    }
    // ---
    // Python
    // ---
    if (existsSync(join(projectRoot, "pytest.ini")) || existsSync(join(projectRoot, "conftest.py"))) {
        return "pytest";
    }
    const pyprojectPath = join(projectRoot, "pyproject.toml");
    if (existsSync(pyprojectPath)) {
        try {
            const content = readFileSync(pyprojectPath, "utf-8");
            if (content.includes("[tool.pytest")) {
                return "pytest";
            }
        }
        catch {
            // ignore read errors
        }
    }
    // ---
    // Go
    // ---
    if (existsSync(join(projectRoot, "go.mod"))) {
        return "go test ./...";
    }
    // ---
    // Rust
    // ---
    if (existsSync(join(projectRoot, "Cargo.toml"))) {
        return "cargo test";
    }
    // ---
    // Ruby
    // ---
    if (existsSync(join(projectRoot, ".rspec"))) {
        return "bundle exec rspec";
    }
    if (existsSync(join(projectRoot, "Gemfile")) && existsSync(join(projectRoot, "spec"))) {
        return "bundle exec rspec";
    }
    // ---
    // Java / Kotlin
    // ---
    if (existsSync(join(projectRoot, "pom.xml"))) {
        return "mvn test";
    }
    if (existsSync(join(projectRoot, "build.gradle")) || existsSync(join(projectRoot, "build.gradle.kts"))) {
        return "./gradlew test";
    }
    // ---
    // Elixir
    // ---
    if (existsSync(join(projectRoot, "mix.exs"))) {
        return "mix test";
    }
    // ---
    // Generic: Makefile with a test target
    // ---
    const makefilePath = join(projectRoot, "Makefile");
    if (existsSync(makefilePath)) {
        try {
            const content = readFileSync(makefilePath, "utf-8");
            if (/^test:/m.test(content)) {
                return "make test";
            }
        }
        catch {
            // ignore read errors
        }
    }
    return null;
}
//# sourceMappingURL=testDetector.js.map