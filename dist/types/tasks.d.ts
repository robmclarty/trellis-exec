import { z } from "zod";
export declare const TaskStatusSchema: z.ZodEnum<{
    pending: "pending";
    "in-progress": "in-progress";
    complete: "complete";
    failed: "failed";
    skipped: "skipped";
}>;
export declare const TaskSchema: z.ZodObject<{
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
}, z.core.$strip>;
export declare const PhaseSchema: z.ZodObject<{
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
}, z.core.$strip>;
export declare const TasksJsonSchema: z.ZodObject<{
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
}, z.core.$strip>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type TasksJson = z.infer<typeof TasksJsonSchema>;
//# sourceMappingURL=tasks.d.ts.map