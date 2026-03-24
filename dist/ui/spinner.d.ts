export interface Spinner {
    /** Stop the animation and clear the spinner line. */
    stop(): void;
    /** Temporarily pause the spinner and clear its line (for printing output). */
    pause(): void;
    /** Resume the spinner after a pause. */
    resume(): void;
}
/**
 * Start a bouncing-bar spinner on stderr with an optional label.
 *
 * The spinner writes to stderr so it never contaminates captured stdout.
 * Calling `stop()` clears the line and restores the cursor.
 */
export declare function formatElapsed(ms: number): string;
export declare function startSpinner(label?: string): Spinner;
//# sourceMappingURL=spinner.d.ts.map