import { z } from "zod";
export declare const CheckResultSchema: z.ZodObject<{
    passed: z.ZodBoolean;
    output: z.ZodOptional<z.ZodString>;
    exitCode: z.ZodNumber;
}, z.core.$strip>;
export declare const JudgeIssueObjectSchema: z.ZodObject<{
    task: z.ZodOptional<z.ZodString>;
    severity: z.ZodOptional<z.ZodString>;
    description: z.ZodString;
}, z.core.$strip>;
export declare const JudgeIssueSchema: z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
    task: z.ZodOptional<z.ZodString>;
    severity: z.ZodOptional<z.ZodString>;
    description: z.ZodString;
}, z.core.$strip>]>;
export declare const JudgeCorrectionSchema: z.ZodObject<{
    type: z.ZodEnum<{
        targetPath: "targetPath";
    }>;
    taskId: z.ZodString;
    old: z.ZodString;
    new: z.ZodString;
    reason: z.ZodString;
}, z.core.$strip>;
export declare const JudgeAssessmentSchema: z.ZodObject<{
    passed: z.ZodBoolean;
    issues: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        task: z.ZodOptional<z.ZodString>;
        severity: z.ZodOptional<z.ZodString>;
        description: z.ZodString;
    }, z.core.$strip>]>>;
    suggestions: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        task: z.ZodOptional<z.ZodString>;
        severity: z.ZodOptional<z.ZodString>;
        description: z.ZodString;
    }, z.core.$strip>]>>;
    corrections: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
        type: z.ZodEnum<{
            targetPath: "targetPath";
        }>;
        taskId: z.ZodString;
        old: z.ZodString;
        new: z.ZodString;
        reason: z.ZodString;
    }, z.core.$strip>>>>;
}, z.core.$strip>;
export declare const DecisionTierSchema: z.ZodEnum<{
    architectural: "architectural";
    tactical: "tactical";
    constraint: "constraint";
}>;
export declare const DecisionEntrySchema: z.ZodObject<{
    text: z.ZodString;
    tier: z.ZodEnum<{
        architectural: "architectural";
        tactical: "tactical";
        constraint: "constraint";
    }>;
}, z.core.$strip>;
export declare const PhaseReportStatusSchema: z.ZodEnum<{
    complete: "complete";
    failed: "failed";
    partial: "partial";
}>;
export declare const RecommendedActionSchema: z.ZodEnum<{
    advance: "advance";
    retry: "retry";
    halt: "halt";
}>;
export declare const BrowserSmokeReportSchema: z.ZodObject<{
    passed: z.ZodBoolean;
    skipped: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodString>;
    consoleErrors: z.ZodArray<z.ZodString>;
    interactionFailures: z.ZodArray<z.ZodString>;
    screenshot: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const BrowserAcceptanceResultSchema: z.ZodObject<{
    criterion: z.ZodString;
    passed: z.ZodBoolean;
    detail: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const BrowserAcceptanceReportSchema: z.ZodObject<{
    passed: z.ZodBoolean;
    results: z.ZodArray<z.ZodObject<{
        criterion: z.ZodString;
        passed: z.ZodBoolean;
        detail: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    retries: z.ZodNumber;
    generatedTestPath: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const PhaseReportSchema: z.ZodObject<{
    phaseId: z.ZodString;
    status: z.ZodEnum<{
        complete: "complete";
        failed: "failed";
        partial: "partial";
    }>;
    summary: z.ZodString;
    tasksCompleted: z.ZodArray<z.ZodString>;
    tasksFailed: z.ZodArray<z.ZodString>;
    judgeAssessment: z.ZodOptional<z.ZodObject<{
        passed: z.ZodBoolean;
        issues: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
            task: z.ZodOptional<z.ZodString>;
            severity: z.ZodOptional<z.ZodString>;
            description: z.ZodString;
        }, z.core.$strip>]>>;
        suggestions: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
            task: z.ZodOptional<z.ZodString>;
            severity: z.ZodOptional<z.ZodString>;
            description: z.ZodString;
        }, z.core.$strip>]>>;
        corrections: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
            type: z.ZodEnum<{
                targetPath: "targetPath";
            }>;
            taskId: z.ZodString;
            old: z.ZodString;
            new: z.ZodString;
            reason: z.ZodString;
        }, z.core.$strip>>>>;
    }, z.core.$strip>>;
    browserSmokeReport: z.ZodOptional<z.ZodObject<{
        passed: z.ZodBoolean;
        skipped: z.ZodBoolean;
        reason: z.ZodOptional<z.ZodString>;
        consoleErrors: z.ZodArray<z.ZodString>;
        interactionFailures: z.ZodArray<z.ZodString>;
        screenshot: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    orchestratorAnalysis: z.ZodString;
    recommendedAction: z.ZodEnum<{
        advance: "advance";
        retry: "retry";
        halt: "halt";
    }>;
    correctiveTasks: z.ZodArray<z.ZodString>;
    decisionsLog: z.ZodArray<z.ZodObject<{
        text: z.ZodString;
        tier: z.ZodEnum<{
            architectural: "architectural";
            tactical: "tactical";
            constraint: "constraint";
        }>;
    }, z.core.$strip>>;
    handoff: z.ZodString;
    startSha: z.ZodOptional<z.ZodString>;
    endSha: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const SharedStateSchema: z.ZodObject<{
    currentPhase: z.ZodString;
    completedPhases: z.ZodArray<z.ZodString>;
    phaseReports: z.ZodArray<z.ZodObject<{
        phaseId: z.ZodString;
        status: z.ZodEnum<{
            complete: "complete";
            failed: "failed";
            partial: "partial";
        }>;
        summary: z.ZodString;
        tasksCompleted: z.ZodArray<z.ZodString>;
        tasksFailed: z.ZodArray<z.ZodString>;
        judgeAssessment: z.ZodOptional<z.ZodObject<{
            passed: z.ZodBoolean;
            issues: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                task: z.ZodOptional<z.ZodString>;
                severity: z.ZodOptional<z.ZodString>;
                description: z.ZodString;
            }, z.core.$strip>]>>;
            suggestions: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                task: z.ZodOptional<z.ZodString>;
                severity: z.ZodOptional<z.ZodString>;
                description: z.ZodString;
            }, z.core.$strip>]>>;
            corrections: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
                type: z.ZodEnum<{
                    targetPath: "targetPath";
                }>;
                taskId: z.ZodString;
                old: z.ZodString;
                new: z.ZodString;
                reason: z.ZodString;
            }, z.core.$strip>>>>;
        }, z.core.$strip>>;
        browserSmokeReport: z.ZodOptional<z.ZodObject<{
            passed: z.ZodBoolean;
            skipped: z.ZodBoolean;
            reason: z.ZodOptional<z.ZodString>;
            consoleErrors: z.ZodArray<z.ZodString>;
            interactionFailures: z.ZodArray<z.ZodString>;
            screenshot: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        orchestratorAnalysis: z.ZodString;
        recommendedAction: z.ZodEnum<{
            advance: "advance";
            retry: "retry";
            halt: "halt";
        }>;
        correctiveTasks: z.ZodArray<z.ZodString>;
        decisionsLog: z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            tier: z.ZodEnum<{
                architectural: "architectural";
                tactical: "tactical";
                constraint: "constraint";
            }>;
        }, z.core.$strip>>;
        handoff: z.ZodString;
        startSha: z.ZodOptional<z.ZodString>;
        endSha: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    phaseRetries: z.ZodRecord<z.ZodString, z.ZodNumber>;
}, z.core.$strip>;
export type DecisionEntry = z.infer<typeof DecisionEntrySchema>;
export type CheckResult = z.infer<typeof CheckResultSchema>;
export type JudgeIssue = z.infer<typeof JudgeIssueSchema>;
export type JudgeCorrection = z.infer<typeof JudgeCorrectionSchema>;
export type JudgeAssessment = z.infer<typeof JudgeAssessmentSchema>;
export type BrowserSmokeReport = z.infer<typeof BrowserSmokeReportSchema>;
export type BrowserAcceptanceResult = z.infer<typeof BrowserAcceptanceResultSchema>;
export type BrowserAcceptanceReport = z.infer<typeof BrowserAcceptanceReportSchema>;
export type PhaseReportStatus = z.infer<typeof PhaseReportStatusSchema>;
export type RecommendedAction = z.infer<typeof RecommendedActionSchema>;
export type PhaseReport = z.infer<typeof PhaseReportSchema>;
export type SharedState = z.infer<typeof SharedStateSchema>;
//# sourceMappingURL=state.d.ts.map