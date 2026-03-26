import { z } from "zod";

export const TaskStatusSchema = z.enum([
  "pending",
  "in-progress",
  "complete",
  "failed",
  "skipped",
]);

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  dependsOn: z.array(z.string()),
  specSections: z.array(z.string()),
  targetPaths: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  subAgentType: z.string(),
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

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type TasksJson = z.infer<typeof TasksJsonSchema>;
