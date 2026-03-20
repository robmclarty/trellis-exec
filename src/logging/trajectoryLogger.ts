import { openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import type { TrajectoryEvent } from "../types/agents.js";

export interface TrajectoryLogger {
  append: (event: Omit<TrajectoryEvent, "timestamp">) => void;
  close: () => void;
}

/**
 * Creates a crash-safe trajectory logger that writes JSONL to the given path.
 * Uses a closure over the file descriptor — not a class.
 */
export function createTrajectoryLogger(logPath: string): TrajectoryLogger {
  let fd = openSync(logPath, "a");
  let closed = false;

  return {
    append(event: Omit<TrajectoryEvent, "timestamp">): void {
      if (closed) {
        throw new Error("TrajectoryLogger is closed");
      }

      const entry: TrajectoryEvent = {
        ...event,
        timestamp: new Date().toISOString(),
      };

      const line = JSON.stringify(entry) + "\n";
      writeSync(fd, line);
      fsyncSync(fd);
    },

    close(): void {
      if (closed) return;
      closeSync(fd);
      closed = true;
    },
  };
}
