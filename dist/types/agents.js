import { z } from "zod";
export const SubAgentConfigSchema = z.object({
    type: z.string(),
    taskId: z.string(),
    instructions: z.string(),
    filePaths: z.array(z.string()),
    outputPaths: z.array(z.string()),
    model: z.string().optional(),
});
export const SubAgentResultSchema = z.object({
    success: z.boolean(),
    output: z.string(),
    filesModified: z.array(z.string()),
    error: z.string().optional(),
});
export const TrajectoryEventTypeSchema = z.enum([
    "repl_exec",
    "sub_agent_dispatch",
    "check_run",
    "judge_invoke",
]);
export const TrajectoryEventSchema = z.object({
    phaseId: z.string(),
    turnNumber: z.number(),
    type: TrajectoryEventTypeSchema,
    input: z.unknown(),
    output: z.unknown(),
    timestamp: z.string(),
    duration: z.number(),
});
//# sourceMappingURL=agents.js.map