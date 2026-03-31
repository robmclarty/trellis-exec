export type ContainerConfig = {
    projectRoot: string;
    tasksJsonDir: string;
    tasksJsonFilename: string;
    specPath: string;
    planPath: string;
    guidelinesPath?: string | undefined;
    containerImage: string;
    containerNetwork: string;
    containerCpus: string;
    containerMemory: string;
    innerCliArgs: string[];
};
/**
 * Builds the `docker run` argument list from a ContainerConfig.
 * Takes `env` as a parameter (not `process.env`) for testability.
 */
export declare function buildDockerArgs(config: ContainerConfig, env: Record<string, string | undefined>): string[];
/**
 * Extracts CLI flags that should be forwarded to the inner container process.
 * Omits flags that are overridden by container paths or that control
 * the container itself.
 */
export declare function buildInnerCliArgs(values: Record<string, string | boolean | undefined>): string[];
export declare function checkDockerAvailable(): boolean;
/**
 * Launches trellis-exec inside a Docker container and returns the exit code.
 * The host process delegates entirely to the container; stdio is inherited
 * so output streams through to the terminal.
 */
export declare function launchInContainer(config: ContainerConfig): Promise<number>;
/**
 * Convenience: build a ContainerConfig from resolved RunContext fields
 * and raw CLI values.
 */
export declare function buildContainerConfig(opts: {
    projectRoot: string;
    tasksJsonPath: string;
    specPath: string;
    planPath: string;
    guidelinesPath?: string | undefined;
    containerImage: string;
    containerNetwork: string;
    containerCpus: string;
    containerMemory: string;
    innerCliArgs: string[];
}): ContainerConfig;
//# sourceMappingURL=containerLauncher.d.ts.map