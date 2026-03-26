import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Frontend framework packages whose presence in package.json deps/devDeps
 * indicates a web application project.
 */
const FRONTEND_PACKAGES = new Set([
  "react",
  "react-dom",
  "vue",
  "svelte",
  "@angular/core",
  "next",
  "nuxt",
  "@sveltejs/kit",
  "solid-js",
  "astro",
]);

/**
 * Config file prefixes that indicate a frontend build tool.
 * Matched against root directory entries via startsWith.
 */
const CONFIG_PREFIXES = [
  "vite.config",
  "webpack.config",
  "next.config",
  "nuxt.config",
  "svelte.config",
  "astro.config",
];

/**
 * Locations where an index.html entry point may live.
 */
const INDEX_HTML_PATHS = ["index.html", "public/index.html", "src/index.html"];

/**
 * Synchronously detects whether the project at `projectRoot` is a web
 * application by checking for frontend framework dependencies, build-tool
 * config files, and HTML entry points.
 *
 * Returns `false` for backend-only, CLI, or library projects, and when the
 * directory is missing or unreadable.
 */
export function detectWebApp(projectRoot: string): boolean {
  try {
    // Check for frontend build-tool config files
    const entries = readdirSync(projectRoot);
    for (const entry of entries) {
      if (CONFIG_PREFIXES.some((prefix) => entry.startsWith(prefix))) {
        return true;
      }
    }

    // Check for index.html entry points
    for (const relPath of INDEX_HTML_PATHS) {
      if (existsSync(join(projectRoot, relPath))) {
        return true;
      }
    }

    // Check package.json for frontend framework dependencies
    const pkgPath = join(projectRoot, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };
      for (const dep of Object.keys(allDeps)) {
        if (FRONTEND_PACKAGES.has(dep)) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}
