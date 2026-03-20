import { readFileSync, readdirSync, statSync, realpathSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { SharedStateSchema } from "../types/state.js";
import type { SharedState, PhaseReport, CheckResult } from "../types/state.js";
import type { SubAgentConfig, SubAgentResult } from "../types/agents.js";

export type AgentLauncher = (config: SubAgentConfig) => Promise<SubAgentResult>;

export type ReplHelpersConfig = {
  projectRoot: string;
  specPath: string;
  statePath: string;
  agentLauncher: AgentLauncher | null;
};

export type ReplHelpers = {
  readFile(path: string): string;
  listDir(
    path: string,
  ): Array<{ name: string; type: "file" | "dir"; size: number }>;
  searchFiles(
    pattern: string,
    glob?: string,
  ): Array<{ path: string; line: number; content: string }>;
  readSpecSections(sections: string[]): string;
  getState(): SharedState;
  writePhaseReport(report: PhaseReport): void;
  dispatchSubAgent(config: SubAgentConfig): Promise<SubAgentResult>;
  runCheck(): Promise<CheckResult>;
  llmQuery(prompt: string, options?: { model?: string }) : Promise<string>;
};

const SEARCH_RESULTS_CAP = 100;

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports `*` (any non-slash chars) and `**` (any chars including slash).
 */
function globToRegex(glob: string): RegExp {
  let pattern = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i]!;
    if (ch === "*" && glob[i + 1] === "*") {
      pattern += ".*";
      i += 2;
      // skip trailing slash after **
      if (glob[i] === "/") i++;
    } else if (ch === "*") {
      pattern += "[^/]*";
      i++;
    } else if (ch === "?") {
      pattern += "[^/]";
      i++;
    } else if (".+^${}()|[]\\".includes(ch)) {
      pattern += "\\" + ch;
      i++;
    } else {
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
function safePath(projectRoot: string, userPath: string): string {
  const resolved = resolve(projectRoot, userPath);
  const realRoot = realpathSync(projectRoot);
  // Use realpath on the resolved path only if it exists; otherwise check the
  // resolved string prefix (covers paths that don't exist yet).
  let realResolved: string;
  try {
    realResolved = realpathSync(resolved);
  } catch {
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
export function createReplHelpers(config: ReplHelpersConfig): ReplHelpers {
  const { projectRoot, specPath, statePath, agentLauncher } = config;

  function readFile(path: string): string {
    const resolved = safePath(projectRoot, path);
    return readFileSync(resolved, "utf-8");
  }

  function listDir(
    path: string,
  ): Array<{ name: string; type: "file" | "dir"; size: number }> {
    const resolved = safePath(projectRoot, path);
    const entries = readdirSync(resolved, { withFileTypes: true });
    return entries
      .map((entry) => {
        const entryType: "file" | "dir" = entry.isDirectory() ? "dir" : "file";
        const size = entry.isDirectory()
          ? 0
          : statSync(join(resolved, entry.name)).size;
        return { name: entry.name, type: entryType, size };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function searchFiles(
    pattern: string,
    glob?: string,
  ): Array<{ path: string; line: number; content: string }> {
    const regex = new RegExp(pattern);
    const globRegex = glob ? globToRegex(glob) : null;
    const results: Array<{ path: string; line: number; content: string }> = [];

    const entries = readdirSync(projectRoot, {
      recursive: true,
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const parentPath = entry.parentPath;
      const fullPath = join(parentPath, entry.name);
      const relPath = relative(projectRoot, fullPath);

      if (globRegex && !globRegex.test(relPath)) continue;

      let content: string;
      try {
        content = readFileSync(fullPath, "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i]!)) {
          results.push({ path: relPath, line: i + 1, content: lines[i]! });
          if (results.length >= SEARCH_RESULTS_CAP) return results;
        }
      }
    }
    return results;
  }

  function readSpecSections(sections: string[]): string {
    if (sections.length === 0) return "";

    const content = readFileSync(specPath, "utf-8");
    const lines = content.split("\n");

    // Parse the spec into sections keyed by §N identifier
    const sectionMap = new Map<string, string>();
    let currentKey: string | null = null;
    let currentLines: string[] = [];

    for (const line of lines) {
      const match = line.match(/^## §(\d+)/);
      if (match) {
        if (currentKey !== null) {
          sectionMap.set(currentKey, currentLines.join("\n").trim());
        }
        currentKey = "§" + match[1];
        currentLines = [line];
      } else if (currentKey !== null) {
        currentLines.push(line);
      }
    }
    if (currentKey !== null) {
      sectionMap.set(currentKey, currentLines.join("\n").trim());
    }

    const parts: string[] = [];
    for (const section of sections) {
      const found = sectionMap.get(section);
      if (found !== undefined) {
        parts.push(found);
      } else {
        parts.push(`[Section ${section} not found]`);
      }
    }
    return parts.join("\n\n---\n\n");
  }

  function getState(): SharedState {
    const raw = readFileSync(statePath, "utf-8");
    return SharedStateSchema.parse(JSON.parse(raw));
  }

  function writePhaseReport(report: PhaseReport): void {
    console.log("[STUB] writePhaseReport:", report.phaseId);
  }

  async function dispatchSubAgent(
    subAgentConfig: SubAgentConfig,
  ): Promise<SubAgentResult> {
    if (agentLauncher) {
      return agentLauncher(subAgentConfig);
    }
    console.log("[STUB] dispatchSubAgent:", subAgentConfig.type, subAgentConfig.taskId);
    return { success: true, output: "[stub] agent dispatched", filesModified: [] };
  }

  async function runCheck(): Promise<CheckResult> {
    console.log("[STUB] runCheck");
    return { passed: true, output: "[stub] check passed", exitCode: 0 };
  }

  async function llmQuery(
    prompt: string,
    options?: { model?: string },
  ): Promise<string> {
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
