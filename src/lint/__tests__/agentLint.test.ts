import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { AgentFrontmatterSchema, parseAgentFrontmatter } from "../agentLint.js";

const AGENTS_DIR = resolve(import.meta.dirname, "../../../agents");

describe("AgentFrontmatterSchema", () => {
  it("accepts valid frontmatter with all supported fields", () => {
    const result = AgentFrontmatterSchema.safeParse({
      name: "code-reviewer",
      description: "Reviews code for quality",
      tools: "Read, Glob, Grep",
      model: "sonnet",
    });
    expect(result.success).toBe(true);
  });

  it("accepts minimal frontmatter with only required fields", () => {
    const result = AgentFrontmatterSchema.safeParse({
      name: "my-agent",
      description: "Does a thing",
    });
    expect(result.success).toBe(true);
  });

  it("rejects frontmatter missing required name", () => {
    const result = AgentFrontmatterSchema.safeParse({
      description: "Does a thing",
    });
    expect(result.success).toBe(false);
  });

  it("rejects frontmatter missing required description", () => {
    const result = AgentFrontmatterSchema.safeParse({
      name: "my-agent",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields like allowed-tools", () => {
    const result = AgentFrontmatterSchema.safeParse({
      name: "my-agent",
      description: "Does a thing",
      "allowed-tools": "Read, Write",
    });
    expect(result.success).toBe(false);
    const error = result.error?.issues[0];
    expect(error?.message).toMatch(/unrecognized/i);
  });

  it("rejects invalid model values", () => {
    const result = AgentFrontmatterSchema.safeParse({
      name: "my-agent",
      description: "Does a thing",
      model: "gpt-4",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid model aliases", () => {
    for (const model of ["sonnet", "opus", "haiku", "inherit"]) {
      const result = AgentFrontmatterSchema.safeParse({
        name: "my-agent",
        description: "Does a thing",
        model,
      });
      expect(result.success, `model "${model}" should be valid`).toBe(true);
    }
  });

  it("accepts full model IDs", () => {
    const result = AgentFrontmatterSchema.safeParse({
      name: "my-agent",
      description: "Does a thing",
      model: "claude-opus-4-6",
    });
    expect(result.success).toBe(true);
  });

  it("rejects names with uppercase or spaces", () => {
    const result = AgentFrontmatterSchema.safeParse({
      name: "My Agent",
      description: "Does a thing",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all optional fields from the docs", () => {
    const result = AgentFrontmatterSchema.safeParse({
      name: "full-agent",
      description: "Agent with all fields",
      tools: "Read, Write, Edit, Bash",
      disallowedTools: "Agent",
      model: "sonnet",
      permissionMode: "default",
      maxTurns: 50,
      memory: "project",
      background: true,
      effort: "high",
      isolation: "worktree",
    });
    expect(result.success).toBe(true);
  });
});

describe("parseAgentFrontmatter", () => {
  it("extracts frontmatter from markdown with --- delimiters", () => {
    const md = `---
name: test-agent
description: A test agent
tools: Read, Write
model: sonnet
---

You are a test agent.`;

    const result = parseAgentFrontmatter(md);
    expect(result).toEqual({
      name: "test-agent",
      description: "A test agent",
      tools: "Read, Write",
      model: "sonnet",
    });
  });

  it("returns null for markdown without frontmatter", () => {
    const result = parseAgentFrontmatter("# Just a heading\nSome text.");
    expect(result).toBeNull();
  });
});

describe("agent files in agents/", () => {
  const agentFiles = readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".md"));

  it("finds at least one agent file", () => {
    expect(agentFiles.length).toBeGreaterThan(0);
  });

  for (const file of agentFiles) {
    it(`${file} has valid frontmatter`, () => {
      const content = readFileSync(join(AGENTS_DIR, file), "utf-8");
      const frontmatter = parseAgentFrontmatter(content);
      expect(frontmatter).not.toBeNull();

      const result = AgentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `  ${i.path.join(".")}: ${i.message}`)
          .join("\n");
        expect.fail(`Invalid frontmatter in ${file}:\n${issues}`);
      }
    });
  }
});
