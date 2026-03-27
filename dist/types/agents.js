import { z } from "zod";
export const SubAgentConfigSchema = z.object({
    type: z.string(),
    taskId: z.string(),
    instructions: z.string(),
    filePaths: z.array(z.string()),
    outputPaths: z.array(z.string()),
    model: z.string().optional(),
});
export const UsageStatsSchema = z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    costUsd: z.number(),
});
export const SubAgentResultSchema = z.object({
    success: z.boolean(),
    output: z.string(),
    filesModified: z.array(z.string()),
    error: z.string().optional(),
    usage: UsageStatsSchema.optional(),
});
export const TrajectoryEventTypeSchema = z.enum([
    "phase_exec",
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