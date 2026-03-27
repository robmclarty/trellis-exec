import { z } from "zod";
export const CheckResultSchema = z.object({
    passed: z.boolean(),
    output: z.string().optional(),
    exitCode: z.number(),
});
export const JudgeIssueObjectSchema = z.object({
    task: z.string().optional(),
    severity: z.string().optional(),
    description: z.string(),
});
export const JudgeIssueSchema = z.union([z.string(), JudgeIssueObjectSchema]);
export const JudgeCorrectionSchema = z.object({
    type: z.enum(["targetPath"]),
    taskId: z.string(),
    old: z.string(),
    new: z.string(),
    reason: z.string(),
});
export const JudgeAssessmentSchema = z.object({
    passed: z.boolean(),
    issues: z.array(JudgeIssueSchema),
    suggestions: z.array(JudgeIssueSchema),
    corrections: z.array(JudgeCorrectionSchema).optional().default([]),
});
export const DecisionTierSchema = z.enum(["architectural", "tactical", "constraint"]);
export const DecisionEntrySchema = z.object({
    text: z.string(),
    tier: DecisionTierSchema,
});
export const PhaseReportStatusSchema = z.enum(["complete", "partial", "failed"]);
export const RecommendedActionSchema = z.enum(["advance", "retry", "halt"]);
export const BrowserSmokeReportSchema = z.object({
    passed: z.boolean(),
    skipped: z.boolean(),
    reason: z.string().optional(),
    consoleErrors: z.array(z.string()),
    interactionFailures: z.array(z.string()),
    screenshot: z.string().optional(),
});
export const BrowserAcceptanceResultSchema = z.object({
    criterion: z.string(),
    passed: z.boolean(),
    detail: z.string().optional(),
});
export const BrowserAcceptanceReportSchema = z.object({
    passed: z.boolean(),
    results: z.array(BrowserAcceptanceResultSchema),
    retries: z.number(),
    generatedTestPath: z.string().optional(),
});
export const PhaseReportSchema = z.object({
    phaseId: z.string(),
    status: PhaseReportStatusSchema,
    summary: z.string(),
    tasksCompleted: z.array(z.string()),
    tasksFailed: z.array(z.string()),
    judgeAssessment: JudgeAssessmentSchema.optional(),
    browserSmokeReport: BrowserSmokeReportSchema.optional(),
    orchestratorAnalysis: z.string(),
    recommendedAction: RecommendedActionSchema,
    correctiveTasks: z.array(z.string()),
    decisionsLog: z.array(DecisionEntrySchema),
    handoff: z.string(),
    startSha: z.string().optional(),
    endSha: z.string().optional(),
    judgeFixCycles: z.number().optional(),
});
export const SharedStateSchema = z.object({
    currentPhase: z.string(),
    completedPhases: z.array(z.string()),
    phaseReports: z.array(PhaseReportSchema),
    phaseRetries: z.record(z.string(), z.number()),
});
//# sourceMappingURL=state.js.map