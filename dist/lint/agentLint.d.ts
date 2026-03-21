import { z } from "zod";
/**
 * Zod schema for Claude Code agent frontmatter, derived from the official docs.
 * Uses `.strict()` so unknown keys (like `allowed-tools`) cause validation errors.
 *
 * @see https://code.claude.com/docs/en/sub-agents
 */
export declare const AgentFrontmatterSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    tools: z.ZodOptional<z.ZodString>;
    disallowedTools: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    permissionMode: z.ZodOptional<z.ZodEnum<{
        default: "default";
        acceptEdits: "acceptEdits";
        dontAsk: "dontAsk";
        bypassPermissions: "bypassPermissions";
        plan: "plan";
    }>>;
    maxTurns: z.ZodOptional<z.ZodNumber>;
    skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
    mcpServers: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    hooks: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    memory: z.ZodOptional<z.ZodEnum<{
        user: "user";
        project: "project";
        local: "local";
    }>>;
    background: z.ZodOptional<z.ZodBoolean>;
    effort: z.ZodOptional<z.ZodEnum<{
        low: "low";
        medium: "medium";
        high: "high";
        max: "max";
    }>>;
    isolation: z.ZodOptional<z.ZodLiteral<"worktree">>;
}, z.core.$strict>;
/**
 * Parses YAML frontmatter from a markdown string.
 * Handles simple key: value pairs, booleans, numbers, and arrays.
 * Returns null if no frontmatter block is found.
 */
export declare function parseAgentFrontmatter(markdown: string): Record<string, unknown> | null;
//# sourceMappingURL=agentLint.d.ts.map