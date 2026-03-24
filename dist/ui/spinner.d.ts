export interface Spinner {
    /** Stop the animation and clear the spinner line. */
    stop(): void;
    /** Temporarily pause the spinner and clear its line (for printing output). */
    pause(): void;
    /** Resume the spinner after a pause. */
    resume(): void;
}
export declare function startSpinner(label?: string): Spinner;
//# sourceMappingURL=spinner.d.ts.map