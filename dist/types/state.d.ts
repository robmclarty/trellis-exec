import { z } from "zod";
export declare const CheckResultSchema: z.ZodObject<{
    passed: z.ZodBoolean;
    output: z.ZodOptional<z.ZodString>;
    exitCode: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const ModifiedFileSchema: z.ZodObject<{
    path: z.ZodString;
    modifiedBy: z.ZodString;
    changeType: z.ZodString;
}, z.core.$strip>;
export declare const SchemaChangeSchema: z.ZodObject<{
    table: z.ZodString;
    action: z.ZodString;
    task: z.ZodString;
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
    }, z.core.$strip>>;
    orchestratorAnalysis: z.ZodString;
    recommendedAction: z.ZodEnum<{
        advance: "advance";
        retry: "retry";
        halt: "halt";
    }>;
    correctiveTasks: z.ZodArray<z.ZodString>;
    decisionsLog: z.ZodArray<z.ZodString>;
    handoff: z.ZodString;
}, z.core.$strip>;
export declare const SharedStateSchema: z.ZodObject<{
    currentPhase: z.ZodString;
    completedPhases: z.ZodArray<z.ZodString>;
    modifiedFiles: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        modifiedBy: z.ZodString;
        changeType: z.ZodString;
    }, z.core.$strip>>;
    schemaChanges: z.ZodArray<z.ZodObject<{
        table: z.ZodString;
        action: z.ZodString;
        task: z.ZodString;
    }, z.core.$strip>>;
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
        }, z.core.$strip>>;
        orchestratorAnalysis: z.ZodString;
        recommendedAction: z.ZodEnum<{
            advance: "advance";
            retry: "retry";
            halt: "halt";
        }>;
        correctiveTasks: z.ZodArray<z.ZodString>;
        decisionsLog: z.ZodArray<z.ZodString>;
        handoff: z.ZodString;
    }, z.core.$strip>>;
    phaseRetries: z.ZodRecord<z.ZodString, z.ZodNumber>;
}, z.core.$strip>;
export type CheckResult = z.infer<typeof CheckResultSchema>;
export type ModifiedFile = z.infer<typeof ModifiedFileSchema>;
export type SchemaChange = z.infer<typeof SchemaChangeSchema>;
export type JudgeIssue = z.infer<typeof JudgeIssueSchema>;
export type JudgeAssessment = z.infer<typeof JudgeAssessmentSchema>;
export type PhaseReportStatus = z.infer<typeof PhaseReportStatusSchema>;
export type RecommendedAction = z.infer<typeof RecommendedActionSchema>;
export type PhaseReport = z.infer<typeof PhaseReportSchema>;
export type SharedState = z.infer<typeof SharedStateSchema>;
//# sourceMappingURL=state.d.ts.map