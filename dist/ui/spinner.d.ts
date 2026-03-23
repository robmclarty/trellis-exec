export interface Spinner {
    /** Stop the animation and clear the spinner line. */
    stop(): void;
}
/**
 * Start a bouncing-bar spinner on stderr with an optional label.
 *
 * The spinner writes to stderr so it never contaminates captured stdout.
 * Calling `stop()` clears the line and restores the cursor.
 */
export declare function startSpinner(label?: string): Spinner;
//# sourceMappingURL=spinner.d.ts.map