import { z } from "zod";
import { TasksJsonSchema } from "./tasks.js";

export const EnrichmentFlagSchema = z.object({
  taskId: z.string(),
  field: z.string(),
  context: z.string(),
  reason: z.string(),
});

export const ParseResultSchema = z.object({
  success: z.boolean(),
  tasksJson: TasksJsonSchema.nullable(),
  enrichmentNeeded: z.array(EnrichmentFlagSchema),
  errors: z.array(z.string()),
});

export type EnrichmentFlag = z.infer<typeof EnrichmentFlagSchema>;
export type ParseResult = z.infer<typeof ParseResultSchema>;
