import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parsePlan } from "../planParser.js";
const FIXTURE_PATH = resolve(import.meta.dirname, "../../../test/fixtures/sample-plan.md");
const SPEC_REF = "spec.md";
const PLAN_REF = "plan.md";
describe("parsePlan", () => {
    it("parses sample-plan.md with correct phase and task counts", () => {
        const content = readFileSync(FIXTURE_PATH, "utf-8");
        const result = parsePlan(content, SPEC_REF, PLAN_REF);
        expect(result.success).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.tasksJson).not.toBeNull();
        expect(result.tasksJson.phases).toHaveLength(2);
        expect(result.tasksJson.phases[0].tasks).toHaveLength(3);
        expect(result.tasksJson.phases[1].tasks).toHaveLength(4);
        expect(result.tasksJson.specRef).toBe(SPEC_REF);
        expect(result.tasksJson.planRef).toBe(PLAN_REF);
    });
    it("extracts §N references into specSections", () => {
        const content = `## Phase 1: Setup

- Configure database
  Set up connection per §3 and §5 requirements.
`;
        const result = parsePlan(content, SPEC_REF, PLAN_REF);
        expect(result.success).toBe(true);
        const task = result.tasksJson.phases[0].tasks[0];
        expect(task.specSections).toEqual(expect.arrayContaining(["§3", "§5"]));
        expect(task.specSections).toHaveLength(2);
    });
    it("extracts backtick paths into targetPaths", () => {
        const content = `## Phase 1: Setup

- Create auth routes
  Build \`src/routes/auth.ts\` and \`src/middleware/jwt.ts\`.
`;
        const result = parsePlan(content, SPEC_REF, PLAN_REF);
        expect(result.success).toBe(true);
        const task = result.tasksJson.phases[0].tasks[0];
        expect(task.targetPaths).toEqual(expect.arrayContaining([
            "src/routes/auth.ts",
            "src/middleware/jwt.ts",
        ]));
    });
    it("infers file-level dependencies correctly", () => {
        const content = `## Phase 1: Setup

- Create database config
  Create \`src/config/database.ts\`.

## Phase 2: Features

- Build auth routes
  Uses \`src/config/database.ts\` for DB access.
`;
        const result = parsePlan(content, SPEC_REF, PLAN_REF);
        expect(result.success).toBe(true);
        const phase2Task = result.tasksJson.phases[1].tasks[0];
        expect(phase2Task.dependsOn).toContain("phase-1-task-1");
    });
    it("classifies sub-agent types from keywords", () => {
        const content = `## Phase 1: Build

- Initialize project structure
  Scaffold the base layout.

- Write unit tests
  Create test files for the module.

- Review code quality
  Evaluate the implementation for best practices.

- Implement the API endpoint
  Build the REST endpoint for users.
`;
        const result = parsePlan(content, SPEC_REF, PLAN_REF);
        expect(result.success).toBe(true);
        const tasks = result.tasksJson.phases[0].tasks;
        expect(tasks[0].subAgentType).toBe("scaffold");
        expect(tasks[1].subAgentType).toBe("test-writer");
        expect(tasks[2].subAgentType).toBe("judge");
        expect(tasks[3].subAgentType).toBe("implement");
    });
    it("flags ambiguous fields for enrichment", () => {
        const content = `## Phase 1: Build

- Set up CI pipeline and review config
  Initialize the CI/CD configuration and setup deployment boilerplate.
  Review the pipeline config for correctness.
`;
        const result = parsePlan(content, SPEC_REF, PLAN_REF);
        expect(result.success).toBe(true);
        expect(result.enrichmentNeeded.length).toBeGreaterThan(0);
        const flag = result.enrichmentNeeded.find((f) => f.field === "subAgentType");
        expect(flag).toBeDefined();
        expect(flag.reason).toMatch(/multiple/i);
    });
    it("returns success: false for document with no phase structure", () => {
        const content = `# Just a document

This is some text without any phase headings.

Some more paragraphs here and there.
`;
        const result = parsePlan(content, SPEC_REF, PLAN_REF);
        expect(result.success).toBe(false);
        expect(result.tasksJson).toBeNull();
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toMatch(/phase boundaries/i);
    });
    it("handles empty document", () => {
        const result = parsePlan("", SPEC_REF, PLAN_REF);
        expect(result.success).toBe(false);
        expect(result.tasksJson).toBeNull();
        expect(result.errors.length).toBeGreaterThan(0);
    });
    it("handles document with headings but no tasks", () => {
        const content = `## Phase 1: Setup

Some description text but no list items.

## Phase 2: Build

More text without any tasks.
`;
        const result = parsePlan(content, SPEC_REF, PLAN_REF);
        expect(result.success).toBe(true);
        expect(result.tasksJson.phases).toHaveLength(2);
        expect(result.tasksJson.phases[0].tasks).toHaveLength(0);
        expect(result.tasksJson.phases[1].tasks).toHaveLength(0);
    });
    it("extracts acceptance criteria from checkboxes and labels", () => {
        const content = `## Phase 1: Setup

- Create config
  Set up the base config.
  Acceptance:
  - [ ] Config file exists
  - [x] Default values are set
`;
        const result = parsePlan(content, SPEC_REF, PLAN_REF);
        expect(result.success).toBe(true);
        const task = result.tasksJson.phases[0].tasks[0];
        expect(task.acceptanceCriteria).toEqual(expect.arrayContaining([
            "Config file exists",
            "Default values are set",
        ]));
    });
    it("handles alternate phase heading styles", () => {
        const content = `## 1. Scaffolding

- First task
  Description here.

## 2. Implementation

- Second task
  More description.
`;
        const result = parsePlan(content, SPEC_REF, PLAN_REF);
        expect(result.success).toBe(true);
        expect(result.tasksJson.phases).toHaveLength(2);
        expect(result.tasksJson.phases[0].name).toBe("Scaffolding");
        expect(result.tasksJson.phases[1].name).toBe("Implementation");
    });
    it("does not extract paths from inside code fences", () => {
        const content = `## Phase 1: Setup

- Create example
  Here is a code block:
  \`\`\`
  import { foo } from "src/internal/secret.ts";
  \`\`\`
  But this path is real: \`src/real/file.ts\`
`;
        const result = parsePlan(content, SPEC_REF, PLAN_REF);
        expect(result.success).toBe(true);
        const task = result.tasksJson.phases[0].tasks[0];
        expect(task.targetPaths).toContain("src/real/file.ts");
        expect(task.targetPaths).not.toContain("src/internal/secret.ts");
    });
    describe("requiresBrowserTest", () => {
        const dirs = [];
        function tmp() {
            const d = mkdtempSync(join(tmpdir(), "parser-browser-"));
            dirs.push(d);
            return d;
        }
        afterEach(() => {
            for (const d of dirs) {
                rmSync(d, { recursive: true, force: true });
            }
            dirs.length = 0;
        });
        it("sets true for phase with UI keywords in task titles", () => {
            const content = `## Phase 1: UI

- Build dashboard component
  Create the main dashboard view with sidebar navigation.
`;
            const result = parsePlan(content, SPEC_REF, PLAN_REF);
            expect(result.success).toBe(true);
            expect(result.tasksJson.phases[0].requiresBrowserTest).toBe(true);
        });
        it("sets true for phase with UI extension target paths", () => {
            const content = `## Phase 1: Components

- Create app shell
  Set up \`src/App.tsx\` and \`src/main.tsx\` entry points.
`;
            const result = parsePlan(content, SPEC_REF, PLAN_REF);
            expect(result.success).toBe(true);
            expect(result.tasksJson.phases[0].requiresBrowserTest).toBe(true);
        });
        it("sets false for backend-only phase without projectRoot", () => {
            const content = `## Phase 1: Data Layer

- Create database module
  Set up \`src/db/connection.ts\` with PostgreSQL pooling.
`;
            const result = parsePlan(content, SPEC_REF, PLAN_REF);
            expect(result.success).toBe(true);
            expect(result.tasksJson.phases[0].requiresBrowserTest).toBe(false);
        });
        it("sets last phase true for web app with no UI keywords", () => {
            const d = tmp();
            writeFileSync(join(d, "vite.config.ts"), "export default {}");
            const content = `## Phase 1: Data Layer

- Create data models
  Set up \`src/models/habit.ts\` with TypeScript interfaces.

## Phase 2: Behaviors

- Add habit tracking logic
  Implement \`src/logic/tracker.ts\` with streak calculation.

## Phase 3: Integration

- Wire up modules
  Connect data layer to behavior layer in \`src/index.ts\`.
`;
            const result = parsePlan(content, SPEC_REF, PLAN_REF, d);
            expect(result.success).toBe(true);
            const phases = result.tasksJson.phases;
            expect(phases).toHaveLength(3);
            expect(phases[0].requiresBrowserTest).toBe(false);
            expect(phases[1].requiresBrowserTest).toBe(false);
            expect(phases[2].requiresBrowserTest).toBe(true);
        });
        it("applies sticky propagation from phase with UI keywords", () => {
            const d = tmp();
            writeFileSync(join(d, "package.json"), JSON.stringify({ dependencies: { react: "^18.0.0" } }));
            const content = `## Phase 1: Data Layer

- Create data models
  Set up \`src/models/habit.ts\` with TypeScript interfaces.

## Phase 2: Components

- Build habit form component
  Create \`src/components/HabitForm.tsx\` for adding habits.

## Phase 3: Integration

- Wire up state management
  Connect store to components in \`src/store/index.ts\`.
`;
            const result = parsePlan(content, SPEC_REF, PLAN_REF, d);
            expect(result.success).toBe(true);
            const phases = result.tasksJson.phases;
            expect(phases).toHaveLength(3);
            expect(phases[0].requiresBrowserTest).toBe(false);
            expect(phases[1].requiresBrowserTest).toBe(true);
            expect(phases[2].requiresBrowserTest).toBe(true);
        });
        it("does not propagate without projectRoot", () => {
            const content = `## Phase 1: Data Layer

- Create data models
  Set up \`src/models/habit.ts\` with TypeScript interfaces.

## Phase 2: Components

- Build dashboard component
  Create the main dashboard view.

## Phase 3: Integration

- Wire up state management
  Connect store to components in \`src/store/index.ts\`.
`;
            const result = parsePlan(content, SPEC_REF, PLAN_REF);
            expect(result.success).toBe(true);
            const phases = result.tasksJson.phases;
            expect(phases).toHaveLength(3);
            expect(phases[0].requiresBrowserTest).toBe(false);
            expect(phases[1].requiresBrowserTest).toBe(true);
            // Phase 3 has no UI keywords and no projectRoot → no propagation
            expect(phases[2].requiresBrowserTest).toBe(false);
        });
    });
});
//# sourceMappingURL=planParser.test.js.map