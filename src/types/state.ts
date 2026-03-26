import { z } from "zod";

export const CheckResultSchema = z.object({
  passed: z.boolean(),
  output: z.string().optional(),
  exitCode: z.number().optional(),
});

export const JudgeIssueObjectSchema = z.object({
  task: z.string().optional(),
  severity: z.string().optional(),
  description: z.string(),
});

export const JudgeIssueSchema = z.union([z.string(), JudgeIssueObjectSchema]);

export const JudgeAssessmentSchema = z.object({
  passed: z.boolean(),
  issues: z.array(JudgeIssueSchema),
  suggestions: z.array(JudgeIssueSchema),
});

export const DecisionTierSchema = z.enum(["architectural", "tactical", "constraint"]);

export const DecisionEntrySchema = z.object({
  text: z.string(),
  tier: DecisionTierSchema,
});

export const PhaseReportStatusSchema = z.enum(["complete", "partial", "failed"]);

export const RecommendedActionSchema = z.enum(["advance", "retry", "halt"]);

export const PhaseReportSchema = z.object({
  phaseId: z.string(),
  status: PhaseReportStatusSchema,
  summary: z.string(),
  tasksCompleted: z.array(z.string()),
  tasksFailed: z.array(z.string()),
  judgeAssessment: JudgeAssessmentSchema.optional(),
  orchestratorAnalysis: z.string(),
  recommendedAction: RecommendedActionSchema,
  correctiveTasks: z.array(z.string()),
  decisionsLog: z.array(DecisionEntrySchema),
  handoff: z.string(),
  startSha: z.string().optional(),
  endSha: z.string().optional(),
});

export const SharedStateSchema = z.object({
  currentPhase: z.string(),
  completedPhases: z.array(z.string()),
  phaseReports: z.array(PhaseReportSchema),
  phaseRetries: z.record(z.string(), z.number()),
  phaseReport: PhaseReportSchema.nullable().default(null),
});

export type DecisionEntry = z.infer<typeof DecisionEntrySchema>;
export type CheckResult = z.infer<typeof CheckResultSchema>;
export type JudgeIssue = z.infer<typeof JudgeIssueSchema>;
export type JudgeAssessment = z.infer<typeof JudgeAssessmentSchema>;
export type PhaseReportStatus = z.infer<typeof PhaseReportStatusSchema>;
export type RecommendedAction = z.infer<typeof RecommendedActionSchema>;
export type PhaseReport = z.infer<typeof PhaseReportSchema>;
export type SharedState = z.infer<typeof SharedStateSchema>;
