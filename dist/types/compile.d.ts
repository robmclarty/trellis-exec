import { z } from "zod";
export declare const EnrichmentFlagSchema: z.ZodObject<{
    taskId: z.ZodString;
    field: z.ZodString;
    context: z.ZodString;
    reason: z.ZodString;
}, z.core.$strip>;
export declare const ParseResultSchema: z.ZodObject<{
    success: z.ZodBoolean;
    tasksJson: z.ZodNullable<z.ZodObject<{
        projectRoot: z.ZodString;
        specRef: z.ZodString;
        planRef: z.ZodString;
        guidelinesRef: z.ZodOptional<z.ZodString>;
        createdAt: z.ZodString;
        phases: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            description: z.ZodString;
            requiresBrowserTest: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
            tasks: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                title: z.ZodString;
                description: z.ZodString;
                dependsOn: z.ZodArray<z.ZodString>;
                specSections: z.ZodArray<z.ZodString>;
                targetPaths: z.ZodArray<z.ZodString>;
                acceptanceCriteria: z.ZodArray<z.ZodString>;
                subAgentType: z.ZodString;
                status: z.ZodEnum<{
                    pending: "pending";
                    "in-progress": "in-progress";
                    complete: "complete";
                    failed: "failed";
                    skipped: "skipped";
                }>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    enrichmentNeeded: z.ZodArray<z.ZodObject<{
        taskId: z.ZodString;
        field: z.ZodString;
        context: z.ZodString;
        reason: z.ZodString;
    }, z.core.$strip>>;
    errors: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type EnrichmentFlag = z.infer<typeof EnrichmentFlagSchema>;
export type ParseResult = z.infer<typeof ParseResultSchema>;
//# sourceMappingURL=compile.d.ts.map