export type RunContext = {
  // Resolved absolute paths
  projectRoot: string;
  specPath: string;
  planPath: string;
  guidelinesPath?: string;
  statePath: string;
  trajectoryPath: string;

  // Execution settings
  checkCommand?: string;
  concurrency: number;
  model?: string;
  maxRetries: number;
  headless: boolean;
  verbose: boolean;
  dryRun: boolean;
  pluginRoot: string;
  tasksJsonPath: string;
  timeout?: number;
  judgeMode: "always" | "on-failure" | "never";
  judgeModel?: string;

  // Browser testing
  devServerCommand?: string;
  saveE2eTests: boolean;
  browserTestRetries: number;

  // Cached file contents (populated once at startup, avoids repeated disk reads)
  specContent?: string;
  guidelinesContent?: string;
};
