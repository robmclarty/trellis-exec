import { z } from "zod";
export declare const SubAgentConfigSchema: z.ZodObject<{
    type: z.ZodString;
    taskId: z.ZodString;
    instructions: z.ZodString;
    filePaths: z.ZodArray<z.ZodString>;
    outputPaths: z.ZodArray<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const SubAgentResultSchema: z.ZodObject<{
    success: z.ZodBoolean;
    output: z.ZodString;
    filesModified: z.ZodArray<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const TrajectoryEventTypeSchema: z.ZodEnum<{
    phase_exec: "phase_exec";
    sub_agent_dispatch: "sub_agent_dispatch";
    check_run: "check_run";
    judge_invoke: "judge_invoke";
}>;
export declare const TrajectoryEventSchema: z.ZodObject<{
    phaseId: z.ZodString;
    turnNumber: z.ZodNumber;
    type: z.ZodEnum<{
        phase_exec: "phase_exec";
        sub_agent_dispatch: "sub_agent_dispatch";
        check_run: "check_run";
        judge_invoke: "judge_invoke";
    }>;
    input: z.ZodUnknown;
    output: z.ZodUnknown;
    timestamp: z.ZodString;
    duration: z.ZodNumber;
}, z.core.$strip>;
export type SubAgentConfig = z.infer<typeof SubAgentConfigSchema>;
export type SubAgentResult = z.infer<typeof SubAgentResultSchema>;
export type TrajectoryEventType = z.infer<typeof TrajectoryEventTypeSchema>;
export type TrajectoryEvent = z.infer<typeof TrajectoryEventSchema>;
//# sourceMappingURL=agents.d.ts.map