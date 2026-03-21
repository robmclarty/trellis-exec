import { z } from "zod";
import { buildEnrichmentPrompt } from "./prompts.js";
const FIELD_DEFAULTS = {
    dependsOn: [],
    subAgentType: "implement",
    acceptanceCriteria: [],
};
const ResolvedEntrySchema = z.object({
    taskId: z.string(),
    field: z.string(),
    value: z.unknown(),
});
const EnrichmentResponseSchema = z.object({
    resolved: z.array(ResolvedEntrySchema),
});
/**
 * Collects all tasks across phases into a flat array.
 */
function collectAllTasks(tasksJson) {
    return tasksJson.phases.flatMap((phase) => phase.tasks);
}
/**
 * Attempts to parse a JSON string that may be wrapped in markdown code fences.
 */
function parseJsonResponse(raw) {
    const stripped = raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
    return JSON.parse(stripped);
}
/**
 * Merges a resolved value into the correct task within tasksJson.
 * Mutates the tasksJson in place for efficiency.
 */
function mergeResolvedField(tasksJson, taskId, field, value) {
    for (const phase of tasksJson.phases) {
        for (const task of phase.tasks) {
            if (task.id === taskId && field in task) {
                task[field] = value;
                return;
            }
        }
    }
}
/**
 * Applies default values for all flagged fields. Used as a fallback when the
 * enricher returns invalid data.
 */
function applyDefaults(tasksJson, flags) {
    for (const flag of flags) {
        const defaultValue = FIELD_DEFAULTS[flag.field];
        if (defaultValue !== undefined) {
            mergeResolvedField(tasksJson, flag.taskId, flag.field, defaultValue);
        }
    }
}
/**
 * Takes the ParseResult from planParser (which includes the partial TasksJson
 * and the EnrichmentFlag array) and uses targeted LLM calls to fill in flagged
 * fields. The enricher parameter is a function wrapping llmQuery, keeping this
 * module testable without real LLM calls.
 */
export async function enrichPlan(parseResult, enricher) {
    if (!parseResult.tasksJson) {
        throw new Error("Cannot enrich a ParseResult with no tasksJson");
    }
    const tasksJson = structuredClone(parseResult.tasksJson);
    if (parseResult.enrichmentNeeded.length === 0) {
        return tasksJson;
    }
    const allTasks = collectAllTasks(tasksJson);
    const prompt = buildEnrichmentPrompt(parseResult.enrichmentNeeded, allTasks);
    let raw;
    try {
        raw = await enricher(prompt);
    }
    catch {
        applyDefaults(tasksJson, parseResult.enrichmentNeeded);
        return tasksJson;
    }
    let parsed;
    try {
        parsed = parseJsonResponse(raw);
    }
    catch {
        applyDefaults(tasksJson, parseResult.enrichmentNeeded);
        return tasksJson;
    }
    const validation = EnrichmentResponseSchema.safeParse(parsed);
    if (!validation.success) {
        applyDefaults(tasksJson, parseResult.enrichmentNeeded);
        return tasksJson;
    }
    for (const entry of validation.data.resolved) {
        mergeResolvedField(tasksJson, entry.taskId, entry.field, entry.value);
    }
    return tasksJson;
}
//# sourceMappingURL=planEnricher.js.map