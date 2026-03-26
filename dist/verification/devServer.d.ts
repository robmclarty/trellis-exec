export type DevServerConfig = {
    command: string;
    cwd: string;
    readyTimeout?: number;
};
export type DevServerHandle = {
    url: string;
    port: number;
    stop(): Promise<void>;
};
/**
 * Attempts to detect a dev server start command from the project.
 * Language-agnostic: checks Node, Python, Ruby, Go, Docker patterns.
 * Returns null if no dev server can be identified.
 */
export declare function detectDevServerCommand(projectRoot: string): string | null;
/**
 * Starts a dev server process and waits until it's ready to accept connections.
 * Detects the port from stdout/stderr or tries common ports.
 */
export declare function startDevServer(config: DevServerConfig): Promise<DevServerHandle>;
//# sourceMappingURL=devServer.d.ts.map