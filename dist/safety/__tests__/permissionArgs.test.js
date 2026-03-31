import { describe, it, expect } from "vitest";
import { buildPermissionArgs, isReadOnlyAgent, READ_ONLY_TOOLS, SAFE_MODE_TOOLS, SAFE_MODE_ALLOWED, SAFE_MODE_DENIED, } from "../permissionArgs.js";
describe("isReadOnlyAgent", () => {
    it("returns true for judge", () => {
        expect(isReadOnlyAgent("judge")).toBe(true);
    });
    it("returns true for reporter", () => {
        expect(isReadOnlyAgent("reporter")).toBe(true);
    });
    it("returns false for worker types", () => {
        expect(isReadOnlyAgent("implement")).toBe(false);
        expect(isReadOnlyAgent("fix")).toBe(false);
        expect(isReadOnlyAgent("scaffold")).toBe(false);
        expect(isReadOnlyAgent("test-writer")).toBe(false);
        expect(isReadOnlyAgent("browser-tester")).toBe(false);
        expect(isReadOnlyAgent("browser-fixer")).toBe(false);
    });
});
describe("buildPermissionArgs", () => {
    // ---
    // Read-only agents (all modes)
    // ---
    describe("readOnly agents", () => {
        it("uses dontAsk + read-only tools in safe mode", () => {
            const args = buildPermissionArgs({ readOnly: true });
            expect(args).toContain("--permission-mode");
            expect(args).toContain("dontAsk");
            for (const tool of READ_ONLY_TOOLS) {
                expect(args).toContain(tool);
            }
            expect(args).not.toContain("--dangerously-skip-permissions");
            expect(args).not.toContain("Write");
            expect(args).not.toContain("Edit");
            expect(args).not.toContain("Bash");
        });
        it("uses read-only tools even in unsafe mode", () => {
            const args = buildPermissionArgs({ readOnly: true, unsafeMode: true });
            expect(args).toContain("dontAsk");
            expect(args).not.toContain("--dangerously-skip-permissions");
            expect(args).not.toContain("Write");
        });
        it("uses read-only tools even in container mode", () => {
            const args = buildPermissionArgs({ readOnly: true, containerMode: true });
            expect(args).toContain("dontAsk");
            expect(args).not.toContain("--dangerously-skip-permissions");
            expect(args).not.toContain("--bare");
        });
        it("includes budget args for read-only agents", () => {
            const args = buildPermissionArgs({ readOnly: true, maxBudgetUsd: 5.0 });
            expect(args).toContain("--max-budget-usd");
            expect(args).toContain("5");
        });
    });
    // ---
    // Container mode (worker)
    // ---
    describe("container mode", () => {
        it("uses dangerously-skip-permissions and bare", () => {
            const args = buildPermissionArgs({ containerMode: true });
            expect(args).toContain("--dangerously-skip-permissions");
            expect(args).toContain("--bare");
            expect(args).not.toContain("--permission-mode");
        });
        it("includes budget args", () => {
            const args = buildPermissionArgs({ containerMode: true, maxBudgetUsd: 10 });
            expect(args).toContain("--max-budget-usd");
            expect(args).toContain("10");
        });
    });
    // ---
    // Unsafe mode (worker)
    // ---
    describe("unsafe mode", () => {
        it("uses dangerously-skip-permissions without bare", () => {
            const args = buildPermissionArgs({ unsafeMode: true });
            expect(args).toContain("--dangerously-skip-permissions");
            expect(args).not.toContain("--bare");
            expect(args).not.toContain("--permission-mode");
        });
        it("includes budget args", () => {
            const args = buildPermissionArgs({ unsafeMode: true, maxBudgetUsd: 3.5 });
            expect(args).toContain("--max-budget-usd");
            expect(args).toContain("3.5");
        });
    });
    // ---
    // Safe mode (default, worker)
    // ---
    describe("safe mode (default)", () => {
        it("uses dontAsk with granular tool controls", () => {
            const args = buildPermissionArgs({});
            expect(args).toContain("--permission-mode");
            expect(args).toContain("dontAsk");
            expect(args).not.toContain("--dangerously-skip-permissions");
        });
        it("includes all safe mode tools via --tools", () => {
            const args = buildPermissionArgs({});
            for (const tool of SAFE_MODE_TOOLS) {
                const toolsIdx = args.indexOf(tool);
                expect(toolsIdx).toBeGreaterThan(-1);
            }
        });
        it("includes allowed tool patterns via --allowedTools", () => {
            const args = buildPermissionArgs({});
            expect(args).toContain("--allowedTools");
            for (const tool of SAFE_MODE_ALLOWED) {
                expect(args).toContain(tool);
            }
        });
        it("includes denied tool patterns via --disallowedTools", () => {
            const args = buildPermissionArgs({});
            expect(args).toContain("--disallowedTools");
            for (const tool of SAFE_MODE_DENIED) {
                expect(args).toContain(tool);
            }
        });
        it("includes budget args when specified", () => {
            const args = buildPermissionArgs({ maxBudgetUsd: 2.5 });
            expect(args).toContain("--max-budget-usd");
            expect(args).toContain("2.5");
        });
        it("omits budget args when not specified", () => {
            const args = buildPermissionArgs({});
            expect(args).not.toContain("--max-budget-usd");
        });
    });
    // ---
    // Priority ordering
    // ---
    describe("priority ordering", () => {
        it("readOnly wins over containerMode and unsafeMode", () => {
            const args = buildPermissionArgs({
                readOnly: true,
                containerMode: true,
                unsafeMode: true,
            });
            expect(args).toContain("dontAsk");
            expect(args).not.toContain("--dangerously-skip-permissions");
            expect(args).not.toContain("--bare");
        });
        it("containerMode wins over unsafeMode for workers", () => {
            const args = buildPermissionArgs({
                containerMode: true,
                unsafeMode: true,
            });
            expect(args).toContain("--bare");
        });
    });
});
//# sourceMappingURL=permissionArgs.test.js.map