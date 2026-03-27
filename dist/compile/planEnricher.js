import { z } from "zod";
import { buildEnrichmentPrompt } from "./prompts.js";
import { stripCodeFences } from "./compilePlan.js";
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
    const stripped = stripCodeFences(raw);
    return JSON.parse(stripped);
}
/**
 * Returns a new TasksJson with the resolved value merged into the matching task.
 */
function mergeResolvedField(tasksJson, taskId, field, value) {
    return {
        ...tasksJson,
        phases: tasksJson.phases.map((phase) => ({
            ...phase,
            tasks: phase.tasks.map((task) => {
                if (task.id === taskId && field in task) {
                    return { ...task, [field]: value };
                }
                return task;
            }),
        })),
    };
}
/**
 * Applies default values for all flagged fields. Used as a fallback when the
 * enricher returns invalid data.
 */
function applyDefaults(tasksJson, flags) {
    let result = tasksJson;
    for (const flag of flags) {
        const defaultValue = FIELD_DEFAULTS[flag.field];
        if (defaultValue !== undefined) {
            result = mergeResolvedField(result, flag.taskId, flag.field, defaultValue);
        }
    }
    return result;
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
    let tasksJson = structuredClone(parseResult.tasksJson);
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
        return applyDefaults(tasksJson, parseResult.enrichmentNeeded);
    }
    let parsed;
    try {
        parsed = parseJsonResponse(raw);
    }
    catch {
        return applyDefaults(tasksJson, parseResult.enrichmentNeeded);
    }
    const validation = EnrichmentResponseSchema.safeParse(parsed);
    if (!validation.success) {
        return applyDefaults(tasksJson, parseResult.enrichmentNeeded);
    }
    for (const entry of validation.data.resolved) {
        tasksJson = mergeResolvedField(tasksJson, entry.taskId, entry.field, entry.value);
    }
    return tasksJson;
}
//# sourceMappingURL=planEnricher.js.map