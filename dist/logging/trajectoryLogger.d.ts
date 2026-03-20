import type { TrajectoryEvent } from "../types/agents.js";
export interface TrajectoryLogger {
    append: (event: Omit<TrajectoryEvent, "timestamp">) => void;
    close: () => void;
}
/**
 * Creates a crash-safe trajectory logger that writes JSONL to the given path.
 * Uses a closure over the file descriptor — not a class.
 */
export declare function createTrajectoryLogger(logPath: string): TrajectoryLogger;
//# sourceMappingURL=trajectoryLogger.d.ts.map