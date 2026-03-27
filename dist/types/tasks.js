import { z } from "zod";
export const TaskStatusSchema = z.enum([
    "pending",
    "in-progress",
    "complete",
    "failed",
    "skipped",
]);
export const KNOWN_AGENT_TYPES = [
    "implement",
    "test-writer",
    "scaffold",
    "judge",
    "fix",
    "reporter",
    "browser-tester",
    "browser-fixer",
];
const KnownAgentTypeSchema = z.enum(KNOWN_AGENT_TYPES);
export const TaskSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    dependsOn: z.array(z.string()),
    specSections: z.array(z.string()),
    targetPaths: z.array(z.string()),
    acceptanceCriteria: z.array(z.string()),
    subAgentType: z.union([KnownAgentTypeSchema, z.string()]),
    status: TaskStatusSchema,
});
export const PhaseSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    requiresBrowserTest: z.boolean().optional().default(false),
    tasks: z.array(TaskSchema),
});
export const TasksJsonSchema = z.object({
    projectRoot: z.string(),
    specRef: z.string(),
    planRef: z.string(),
    guidelinesRef: z.string().optional(),
    createdAt: z.string(),
    phases: z.array(PhaseSchema),
});
//# sourceMappingURL=tasks.js.map