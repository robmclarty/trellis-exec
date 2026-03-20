import { z } from "zod";

const MODEL_ALIASES = ["sonnet", "opus", "haiku", "inherit"] as const;
const MODEL_ID_PATTERN = /^claude-[a-z0-9-]+$/;
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

const modelSchema = z
  .string()
  .refine(
    (v) =>
      (MODEL_ALIASES as readonly string[]).includes(v) ||
      MODEL_ID_PATTERN.test(v),
    { message: "Must be a model alias (sonnet, opus, haiku, inherit) or a full model ID (e.g. claude-opus-4-6)" },
  );

/**
 * Zod schema for Claude Code agent frontmatter, derived from the official docs.
 * Uses `.strict()` so unknown keys (like `allowed-tools`) cause validation errors.
 *
 * @see https://code.claude.com/docs/en/sub-agents
 */
export const AgentFrontmatterSchema = z
  .object({
    name: z
      .string()
      .regex(NAME_PATTERN, "Must be lowercase letters and hyphens only"),
    description: z.string().min(1),
    tools: z.string().optional(),
    disallowedTools: z.string().optional(),
    model: modelSchema.optional(),
    permissionMode: z
      .enum(["default", "acceptEdits", "dontAsk", "bypassPermissions", "plan"])
      .optional(),
    maxTurns: z.number().int().positive().optional(),
    skills: z.array(z.string()).optional(),
    mcpServers: z.array(z.unknown()).optional(),
    hooks: z.record(z.unknown()).optional(),
    memory: z.enum(["user", "project", "local"]).optional(),
    background: z.boolean().optional(),
    effort: z.enum(["low", "medium", "high", "max"]).optional(),
    isolation: z.literal("worktree").optional(),
  })
  .strict();

/**
 * Parses YAML frontmatter from a markdown string.
 * Handles simple key: value pairs, booleans, numbers, and arrays.
 * Returns null if no frontmatter block is found.
 */
export function parseAgentFrontmatter(
  markdown: string,
): Record<string, unknown> | null {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---") return null;

  const endIndex = lines.indexOf("---", 1);
  if (endIndex === -1) return null;

  const yamlLines = lines.slice(1, endIndex);
  const result: Record<string, unknown> = {};

  let currentKey: string | null = null;
  let currentArray: unknown[] | null = null;

  for (const line of yamlLines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    // Array item (indented "- value")
    if (/^\s+-\s+/.test(line) && currentKey !== null && currentArray !== null) {
      currentArray.push(parseYamlValue(trimmed.slice(2).trim()));
      continue;
    }

    // Flush any pending array
    if (currentKey !== null && currentArray !== null) {
      result[currentKey] = currentArray;
      currentKey = null;
      currentArray = null;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    if (rawValue === "") {
      // Could be start of an array or map — set up for array collection
      currentKey = key;
      currentArray = [];
    } else {
      result[key] = parseYamlValue(rawValue);
    }
  }

  // Flush trailing array
  if (currentKey !== null && currentArray !== null) {
    result[currentKey] = currentArray;
  }

  return Object.keys(result).length > 0 ? result : null;
}

function parseYamlValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  // Strip quotes
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}
