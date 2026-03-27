/**
 * Synchronously detects whether the project at `projectRoot` is a web
 * application by checking for frontend framework dependencies, build-tool
 * config files, HTML entry points, and non-JS web frameworks (Django, Rails,
 * Phoenix). Non-JS frameworks require two signals to avoid false positives
 * on API-only projects.
 *
 * Returns `false` for backend-only, CLI, or library projects, and when the
 * directory is missing or unreadable.
 */
export declare function detectWebApp(projectRoot: string): boolean;
//# sourceMappingURL=detectWebApp.d.ts.map