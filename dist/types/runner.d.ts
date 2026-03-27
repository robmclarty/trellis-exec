export type RunContext = {
    projectRoot: string;
    specPath: string;
    planPath: string;
    guidelinesPath?: string;
    statePath: string;
    trajectoryPath: string;
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
    devServerCommand?: string;
    saveE2eTests: boolean;
    browserTestRetries: number;
    specContent?: string;
    guidelinesContent?: string;
};
//# sourceMappingURL=runner.d.ts.map