import { readFileSync, readdirSync, statSync, realpathSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { SharedStateSchema } from "../types/state.js";
const SEARCH_RESULTS_CAP = 100;
/**
 * Convert a simple glob pattern to a RegExp.
 * Supports `*` (any non-slash chars) and `**` (any chars including slash).
 */
function globToRegex(glob) {
    let pattern = "";
    let i = 0;
    while (i < glob.length) {
        const ch = glob[i];
        if (ch === "*" && glob[i + 1] === "*") {
            pattern += ".*";
            i += 2;
            // skip trailing slash after **
            if (glob[i] === "/")
                i++;
        }
        else if (ch === "*") {
            pattern += "[^/]*";
            i++;
        }
        else if (ch === "?") {
            pattern += "[^/]";
            i++;
        }
        else if (".+^${}()|[]\\".includes(ch)) {
            pattern += "\\" + ch;
            i++;
        }
        else {
            pattern += ch;
            i++;
        }
    }
    return new RegExp("^" + pattern + "$");
}
/**
 * Resolve a user-supplied path relative to projectRoot and verify it doesn't
 * escape the project boundary.
 */
function safePath(projectRoot, userPath) {
    const resolved = resolve(projectRoot, userPath);
    const realRoot = realpathSync(projectRoot);
    // Use realpath on the resolved path only if it exists; otherwise check the
    // resolved string prefix (covers paths that don't exist yet).
    let realResolved;
    try {
        realResolved = realpathSync(resolved);
    }
    catch {
        realResolved = resolved;
    }
    if (!realResolved.startsWith(realRoot + "/") && realResolved !== realRoot) {
        throw new Error("Path is outside project root: " + userPath);
    }
    return realResolved;
}
/**
 * Creates the REPL helper functions that are injected into the orchestrator's
 * vm sandbox. Filesystem helpers use real implementations; LLM-dependent
 * helpers are stubs that log and return mock responses.
 */
export function createReplHelpers(config) {
    const { projectRoot, specPath, statePath, agentLauncher } = config;
    /**
     * Reads a file from the project directory and returns its contents as a string.
     * Paths are resolved relative to projectRoot; traversal outside the root throws.
     * @param path - Relative or absolute path to the file
     * @returns The file contents as UTF-8 text
     */
    function readFile(path) {
        const resolved = safePath(projectRoot, path);
        return readFileSync(resolved, "utf-8");
    }
    /**
     * Lists directory contents with name, type, and size for each entry.
     * Directories report size as 0. Results are sorted alphabetically by name.
     * @param path - Relative or absolute path to the directory
     * @returns Array of entries with name, type ("file" | "dir"), and size in bytes
     */
    function listDir(path) {
        const resolved = safePath(projectRoot, path);
        const entries = readdirSync(resolved, { withFileTypes: true });
        return entries
            .map((entry) => {
            const entryType = entry.isDirectory() ? "dir" : "file";
            const size = entry.isDirectory()
                ? 0
                : statSync(join(resolved, entry.name)).size;
            return { name: entry.name, type: entryType, size };
        })
            .sort((a, b) => a.name.localeCompare(b.name));
    }
    /**
     * Searches all files under projectRoot for lines matching a regex pattern.
     * Optionally filters files by a glob pattern. Results are capped at 100 matches.
     * Files that fail to read as UTF-8 are silently skipped.
     * @param pattern - Regular expression pattern to match against each line
     * @param glob - Optional glob pattern to filter which files are searched
     * @returns Array of matches with relative path, 1-based line number, and line content
     */
    function searchFiles(pattern, glob) {
        let regex;
        try {
            if (pattern.length > 200) {
                return [];
            }
            regex = new RegExp(pattern);
        }
        catch {
            return [];
        }
        const globRegex = glob ? globToRegex(glob) : null;
        const results = [];
        const entries = readdirSync(projectRoot, {
            recursive: true,
            withFileTypes: true,
        });
        for (const entry of entries) {
            if (!entry.isFile())
                continue;
            const parentPath = entry.parentPath;
            const fullPath = join(parentPath, entry.name);
            const relPath = relative(projectRoot, fullPath);
            if (globRegex && !globRegex.test(relPath))
                continue;
            let content;
            try {
                content = readFileSync(fullPath, "utf-8");
            }
            catch {
                continue;
            }
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                    results.push({ path: relPath, line: i + 1, content: lines[i] });
                    if (results.length >= SEARCH_RESULTS_CAP)
                        return results;
                }
            }
        }
        return results;
    }
    /**
     * Extracts specific sections from the spec file by section identifier.
     * Parses headings matching `## §N` and returns the content between them.
     * Multiple sections are joined with `---` separators. Missing sections
     * produce a `[Section §N not found]` marker.
     * @param sections - Array of section identifiers (e.g. ["§2", "§5"])
     * @returns Concatenated markdown content of the requested sections
     */
    function readSpecSections(sections) {
        if (sections.length === 0)
            return "";
        let content;
        try {
            content = readFileSync(specPath, "utf-8");
        }
        catch {
            return sections
                .map((s) => `[Section ${s} not found — spec file unavailable]`)
                .join("\n\n---\n\n");
        }
        const lines = content.split("\n");
        // Parse the spec into sections keyed by §N identifier
        const sectionMap = new Map();
        let currentKey = null;
        let currentLines = [];
        for (const line of lines) {
            const match = line.match(/^## §(\d+)/);
            if (match) {
                if (currentKey !== null) {
                    sectionMap.set(currentKey, currentLines.join("\n").trim());
                }
                currentKey = "§" + match[1];
                currentLines = [line];
            }
            else if (currentKey !== null) {
                currentLines.push(line);
            }
        }
        if (currentKey !== null) {
            sectionMap.set(currentKey, currentLines.join("\n").trim());
        }
        const parts = [];
        for (const section of sections) {
            const found = sectionMap.get(section);
            if (found !== undefined) {
                parts.push(found);
            }
            else {
                parts.push(`[Section ${section} not found]`);
            }
        }
        return parts.join("\n\n---\n\n");
    }
    /**
     * Reads and validates the shared state from the state.json file on disk.
     * @returns The current SharedState, validated against the Zod schema
     */
    function getState() {
        let raw;
        try {
            raw = readFileSync(statePath, "utf-8");
        }
        catch (err) {
            if (err instanceof Error &&
                "code" in err &&
                err.code === "ENOENT") {
                return SharedStateSchema.parse({
                    currentPhase: "",
                    completedPhases: [],
                    phaseReports: [],
                    phaseRetries: {},
                    modifiedFiles: [],
                    schemaChanges: [],
                });
            }
            throw err;
        }
        return SharedStateSchema.parse(JSON.parse(raw));
    }
    /**
     * Writes a phase report at the end of a phase. Currently a stub that logs
     * the report's phase ID; the real implementation will persist to disk.
     * @param report - The phase report to write
     */
    function writePhaseReport(report) {
        console.log("[STUB] writePhaseReport:", report.phaseId);
    }
    /**
     * Dispatches a sub-agent to execute a task. Delegates to the configured
     * agentLauncher if provided; otherwise returns a stub success response.
     * @param subAgentConfig - Sub-agent type, task ID, instructions, and file scoping
     * @returns The sub-agent execution result
     */
    async function dispatchSubAgent(subAgentConfig) {
        if (agentLauncher) {
            return agentLauncher(subAgentConfig);
        }
        console.log("[STUB] dispatchSubAgent:", subAgentConfig.type, subAgentConfig.taskId);
        return { success: true, output: "[stub] agent dispatched", filesModified: [] };
    }
    /**
     * Runs the user-defined check command against the project (e.g. lint + test).
     * Currently a stub that returns a passing result.
     * @returns The check result with pass/fail status and output
     */
    async function runCheck() {
        console.log("[STUB] runCheck");
        return { passed: true, output: "[stub] check passed", exitCode: 0 };
    }
    /**
     * Sends a prompt to a fast LLM for quick analysis (not full task execution).
     * Currently a stub that returns a placeholder response.
     * @param prompt - The prompt text to send
     * @param options - Optional model override (defaults to Haiku)
     * @returns The LLM response text
     */
    async function llmQuery(prompt, options) {
        console.log("[STUB] llmQuery:", prompt.slice(0, 80), options?.model ?? "");
        return "[stub] LLM response";
    }
    return {
        readFile,
        listDir,
        searchFiles,
        readSpecSections,
        getState,
        writePhaseReport,
        dispatchSubAgent,
        runCheck,
        llmQuery,
    };
}
//# sourceMappingURL=replHelpers.js.map