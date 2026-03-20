import type { TasksJson, Task, Phase } from "../types/tasks.js";
import type { EnrichmentFlag, ParseResult } from "../types/compile.js";

// --- Phase heading detection ---

const PHASE_HEADING_PATTERNS = [
  // "## Phase 1: Scaffolding" or "# Phase 1 — Scaffolding"
  /^#{1,3}\s+[Pp]hase\s+(\d+)\s*[:—\-–]\s*(.+)$/,
  // "## 1. Scaffolding"
  /^#{1,3}\s+(\d+)\.\s+(.+)$/,
];

/**
 * Attempts to parse a markdown heading as a phase boundary.
 * Supports formats like "## Phase 1: Name", "## 1. Name", "# Phase 1 — Name".
 * Returns the phase number and name, or null if the line is not a phase heading.
 */
function parsePhaseHeading(
  line: string,
): { number: number; name: string } | null {
  for (const pattern of PHASE_HEADING_PATTERNS) {
    const match = pattern.exec(line);
    if (match) {
      const num = match[1];
      const name = match[2];
      if (num !== undefined && name !== undefined) {
        return { number: parseInt(num, 10), name: name.trim() };
      }
    }
  }
  return null;
}

// --- Task line detection ---

const TASK_LINE_PATTERN = /^(?:-|\d+\.)\s+(.+)$/;

/**
 * Detects a zero-indent list item ("- " or "N. ") and returns the title text.
 * Indented sub-items are not matched — they belong to the current task's description.
 */
function parseTaskLine(line: string): string | null {
  const match = TASK_LINE_PATTERN.exec(line);
  if (match && match[1] !== undefined) {
    return match[1];
  }
  return null;
}

/** Returns true if the line starts with 2+ spaces or a tab (task description continuation). */
function isIndentedContent(line: string): boolean {
  return /^(?:  |\t)/.test(line);
}

/** Returns true if the line is a code fence boundary (triple backticks). */
function isCodeFenceBoundary(line: string): boolean {
  return /^\s*```/.test(line);
}

// --- Extractors ---

/** Finds all §N spec section references in the text and returns them deduplicated. */
function extractSpecSections(text: string): string[] {
  const matches = new Set<string>();
  const regex = /§(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[0] !== undefined) {
      matches.add(match[0]);
    }
  }
  return [...matches];
}

const PATH_EXTENSIONS =
  /\.(ts|tsx|js|jsx|json|md|yaml|yml|toml|css|html|sql|sh|env|py|go|rs|vue|svelte)$/;

/** Heuristic: returns true if the string contains a "/" or ends with a known file extension. */
function looksLikePath(s: string): boolean {
  return s.includes("/") || PATH_EXTENSIONS.test(s);
}

/**
 * Extracts file paths from backtick-delimited strings in the text.
 * Code fence blocks are stripped first to avoid false positives from code examples.
 */
function extractBacktickPaths(text: string): string[] {
  // Remove code fence blocks before extracting
  const withoutFences = text.replace(/```[\s\S]*?```/g, "");
  const paths = new Set<string>();
  const regex = /`([^`]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(withoutFences)) !== null) {
    const candidate = match[1];
    if (candidate !== undefined && looksLikePath(candidate)) {
      paths.add(candidate);
    }
  }
  return [...paths];
}

/**
 * Extracts acceptance criteria from a task description.
 * Recognizes checkbox items ("- [ ] ..."), and lines following
 * "Acceptance:", "Verify:", or "Criteria:" labels.
 */
function extractAcceptanceCriteria(description: string): string[] {
  const criteria: string[] = [];
  const lines = description.split("\n");
  let inCriteriaBlock = false;

  for (const line of lines) {
    // Check for checkbox items anywhere
    const checkboxMatch = /^\s*-\s*\[[ x]\]\s*(.+)$/.exec(line);
    if (checkboxMatch && checkboxMatch[1] !== undefined) {
      criteria.push(checkboxMatch[1].trim());
      inCriteriaBlock = false;
      continue;
    }

    // Check for Acceptance: / Verify: / Criteria: labels
    if (/^\s*(acceptance|verify|criteria)\s*:/i.test(line)) {
      inCriteriaBlock = true;
      // Check if there's content after the colon on the same line
      const afterColon = line.replace(/^\s*(acceptance|verify|criteria)\s*:\s*/i, "").trim();
      if (afterColon) {
        criteria.push(afterColon);
      }
      continue;
    }

    // Collect indented lines after a criteria label
    if (inCriteriaBlock) {
      const trimmed = line.trim();
      if (trimmed === "") {
        inCriteriaBlock = false;
      } else if (/^\s+/.test(line)) {
        // Remove leading "- " if present
        criteria.push(trimmed.replace(/^-\s+/, ""));
      } else {
        inCriteriaBlock = false;
      }
    }
  }

  return criteria;
}

// --- Sub-agent classification ---

type Classification = { type: string; ambiguous: boolean };

const AGENT_KEYWORDS: Array<{ type: string; pattern: RegExp }> = [
  { type: "test-writer", pattern: /\btests?\b|\bspec\b|\btest\s+files?\b/i },
  {
    type: "scaffold",
    pattern: /\bscaffold\b|\bboilerplate\b|\bconfig\b|\bsetup\b|\binitializ\w*/i,
  },
  { type: "judge", pattern: /\breview\b|\bevaluat\w*\b|\bjudge\b|\bassess\b/i },
];

/**
 * Classifies a task's sub-agent type based on keyword matching against the
 * title and description. Priority order: test-writer > scaffold > judge > implement.
 * If multiple categories match, returns the highest-priority match and marks ambiguous.
 */
function classifySubAgentType(
  title: string,
  description: string,
): Classification {
  const text = `${title} ${description}`;
  const matched: string[] = [];

  for (const kw of AGENT_KEYWORDS) {
    if (kw.pattern.test(text)) {
      matched.push(kw.type);
    }
  }

  if (matched.length === 0) {
    return { type: "implement", ambiguous: false };
  }
  if (matched.length === 1) {
    return { type: matched[0]!, ambiguous: false };
  }
  // Multiple matches = ambiguous, pick first by priority
  return { type: matched[0]!, ambiguous: true };
}

// --- Dependency inference ---

/**
 * Infers task dependencies by checking for targetPaths overlap.
 * If task B shares a file path with an earlier task A, B depends on A.
 * Tasks are compared in order (flattened across phases).
 */
function inferDependencies(
  allTasks: Array<{ id: string; targetPaths: string[] }>,
): Map<string, string[]> {
  const deps = new Map<string, string[]>();

  for (let i = 0; i < allTasks.length; i++) {
    const task = allTasks[i]!;
    const taskDeps: string[] = [];

    for (let j = 0; j < i; j++) {
      const earlier = allTasks[j]!;
      if (hasPathOverlap(earlier.targetPaths, task.targetPaths)) {
        taskDeps.push(earlier.id);
      }
    }

    if (taskDeps.length > 0) {
      deps.set(task.id, taskDeps);
    }
  }

  return deps;
}

/** Returns true if any path in pathsA exactly matches any path in pathsB. */
function hasPathOverlap(pathsA: string[], pathsB: string[]): boolean {
  for (const a of pathsA) {
    for (const b of pathsB) {
      if (a === b) return true;
    }
  }
  return false;
}

// --- State machine ---

type RawTask = {
  title: string;
  descriptionLines: string[];
};

type RawPhase = {
  number: number;
  name: string;
  rawTasks: RawTask[];
};

type ParserState = {
  currentPhase: { number: number; name: string } | null;
  currentTask: RawTask | null;
  inCodeFence: boolean;
  phases: RawPhase[];
};

/** Pushes the current in-progress task onto the current phase's task list and resets it. */
function finalizeTask(state: ParserState): void {
  if (state.currentTask && state.currentPhase) {
    const lastPhase = state.phases[state.phases.length - 1];
    if (lastPhase) {
      lastPhase.rawTasks.push(state.currentTask);
    }
  }
  state.currentTask = null;
}

/** Finalizes the current task (if any) and resets the current phase. */
function finalizePhase(state: ParserState): void {
  finalizeTask(state);
  state.currentPhase = null;
}

/**
 * Line-by-line state machine that splits markdown into raw phases and tasks.
 * Tracks code fence state to avoid misinterpreting fenced content as structure.
 */
function parseLines(lines: string[]): RawPhase[] {
  const state: ParserState = {
    currentPhase: null,
    currentTask: null,
    inCodeFence: false,
    phases: [],
  };

  for (const line of lines) {
    // Handle code fences
    if (isCodeFenceBoundary(line)) {
      state.inCodeFence = !state.inCodeFence;
      if (state.currentTask) {
        state.currentTask.descriptionLines.push(line);
      }
      continue;
    }

    // Inside a code fence, just accumulate into current task
    if (state.inCodeFence) {
      if (state.currentTask) {
        state.currentTask.descriptionLines.push(line);
      }
      continue;
    }

    // Try phase heading
    const phaseHeading = parsePhaseHeading(line);
    if (phaseHeading) {
      finalizePhase(state);
      state.currentPhase = phaseHeading;
      state.phases.push({
        number: phaseHeading.number,
        name: phaseHeading.name,
        rawTasks: [],
      });
      continue;
    }

    // Try task line (only if we're in a phase)
    if (state.currentPhase) {
      const taskTitle = parseTaskLine(line);
      if (taskTitle) {
        finalizeTask(state);
        state.currentTask = { title: taskTitle, descriptionLines: [] };
        continue;
      }
    }

    // Indented content or blank line within a task
    if (state.currentTask) {
      if (isIndentedContent(line) || line.trim() === "") {
        state.currentTask.descriptionLines.push(line);
      }
    }
  }

  // Finalize remaining state
  finalizePhase(state);

  return state.phases;
}

// --- Assembly ---

/**
 * Assembles raw parsed phases into a complete TasksJson structure.
 * Runs all extractors (spec sections, paths, criteria, agent type) on each task,
 * infers cross-task dependencies, and collects enrichment flags for ambiguous fields.
 */
function buildTasksJson(
  rawPhases: RawPhase[],
  specRef: string,
  planRef: string,
): { tasksJson: TasksJson; enrichmentNeeded: EnrichmentFlag[] } {
  const enrichmentNeeded: EnrichmentFlag[] = [];
  const allTaskMeta: Array<{ id: string; targetPaths: string[] }> = [];
  const phases: Phase[] = [];

  for (const rawPhase of rawPhases) {
    const phaseId = `phase-${String(rawPhase.number)}`;
    const tasks: Task[] = [];

    for (let taskIdx = 0; taskIdx < rawPhase.rawTasks.length; taskIdx++) {
      const raw = rawPhase.rawTasks[taskIdx]!;
      const taskId = `${phaseId}-task-${String(taskIdx + 1)}`;
      const description = raw.descriptionLines
        .map((l) => l.replace(/^  /, ""))
        .join("\n")
        .trim();
      const fullText = `${raw.title}\n${description}`;

      const specSections = extractSpecSections(fullText);
      const targetPaths = extractBacktickPaths(fullText);
      const acceptanceCriteria = extractAcceptanceCriteria(description);
      const classification = classifySubAgentType(raw.title, description);

      if (classification.ambiguous) {
        enrichmentNeeded.push({
          taskId,
          field: "subAgentType",
          context: fullText.slice(0, 200),
          reason: "Multiple sub-agent type keywords matched",
        });
      }

      allTaskMeta.push({ id: taskId, targetPaths });

      tasks.push({
        id: taskId,
        title: raw.title,
        description,
        dependsOn: [], // filled after inference
        specSections,
        targetPaths,
        acceptanceCriteria,
        subAgentType: classification.type,
        status: "pending",
      });
    }

    phases.push({
      id: phaseId,
      name: rawPhase.name,
      description: "",
      tasks,
    });
  }

  // Infer dependencies across all tasks
  const deps = inferDependencies(allTaskMeta);
  for (const phase of phases) {
    for (const task of phase.tasks) {
      const inferred = deps.get(task.id);
      if (inferred) {
        task.dependsOn = inferred;
      }
    }
  }

  const tasksJson: TasksJson = {
    specRef,
    planRef,
    createdAt: new Date().toISOString(),
    phases,
  };

  return { tasksJson, enrichmentNeeded };
}

// --- Public API ---

/**
 * Deterministic Stage 1 parser that converts plan.md markdown into a TasksJson structure.
 * Extracts phases, tasks, spec references, file paths, dependencies, sub-agent types,
 * and acceptance criteria without any LLM calls. Fields that cannot be resolved
 * deterministically are flagged in enrichmentNeeded for Stage 2 (Haiku enrichment).
 * Returns success: false if no phase boundaries can be identified.
 */
export function parsePlan(
  planContent: string,
  specRef: string,
  planRef: string,
): ParseResult {
  if (!planContent.trim()) {
    return {
      success: false,
      tasksJson: null,
      enrichmentNeeded: [],
      errors: ["Empty plan content"],
    };
  }

  const lines = planContent.split("\n");
  const rawPhases = parseLines(lines);

  if (rawPhases.length === 0) {
    return {
      success: false,
      tasksJson: null,
      enrichmentNeeded: [],
      errors: [
        "Could not identify phase boundaries in plan. The plan may require full LLM parsing.",
      ],
    };
  }

  const { tasksJson, enrichmentNeeded } = buildTasksJson(
    rawPhases,
    specRef,
    planRef,
  );

  return {
    success: true,
    tasksJson,
    enrichmentNeeded,
    errors: [],
  };
}
