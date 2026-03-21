import type { ParseResult } from "../types/compile.js";
import type { TasksJson } from "../types/tasks.js";
/**
 * Takes the ParseResult from planParser (which includes the partial TasksJson
 * and the EnrichmentFlag array) and uses targeted LLM calls to fill in flagged
 * fields. The enricher parameter is a function wrapping llmQuery, keeping this
 * module testable without real LLM calls.
 */
export declare function enrichPlan(parseResult: ParseResult, enricher: (prompt: string) => Promise<string>): Promise<TasksJson>;
//# sourceMappingURL=planEnricher.d.ts.map