import { openSync, writeSync, fsyncSync, closeSync } from "node:fs";
/**
 * Creates a crash-safe trajectory logger that writes JSONL to the given path.
 * Uses a closure over the file descriptor — not a class.
 */
export function createTrajectoryLogger(logPath) {
    let fd = openSync(logPath, "a");
    let closed = false;
    return {
        append(event) {
            if (closed) {
                throw new Error("TrajectoryLogger is closed");
            }
            const entry = {
                ...event,
                timestamp: new Date().toISOString(),
            };
            const line = JSON.stringify(entry) + "\n";
            writeSync(fd, line);
            fsyncSync(fd);
        },
        close() {
            if (closed)
                return;
            closeSync(fd);
            closed = true;
        },
    };
}
//# sourceMappingURL=trajectoryLogger.js.map