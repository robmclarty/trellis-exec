// Bouncing-bar spinner ("Cylon eye") for indicating LLM thinking.
//
// Frames animate a lit segment bouncing left-to-right and back:
//   [=   ] → [==  ] → [=== ] → [====] → [ ===] → [  ==] → [   =] → [    ]
const FRAMES = [
    "[    ]",
    "[=   ]",
    "[==  ]",
    "[=== ]",
    "[====]",
    "[ ===]",
    "[  ==]",
    "[   =]",
];
const DEFAULT_INTERVAL_MS = 120;
/**
 * Start a bouncing-bar spinner on stderr with an optional label.
 *
 * The spinner writes to stderr so it never contaminates captured stdout.
 * Calling `stop()` clears the line and restores the cursor.
 */
function formatElapsed(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
        return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
    }
    return `${seconds}s`;
}
export function startSpinner(label) {
    // If stderr is not a TTY (e.g. piped to a file), skip animation entirely.
    if (!process.stderr.isTTY) {
        return { stop() { } };
    }
    let frameIndex = 0;
    const prefix = label ? `${label} ` : "";
    const startTime = Date.now();
    const timer = setInterval(() => {
        const frame = FRAMES[frameIndex % FRAMES.length];
        const elapsed = formatElapsed(Date.now() - startTime);
        // \r moves cursor to start of line; the frame overwrites previous output.
        process.stderr.write(`\r${prefix}${frame} (${elapsed})`);
        frameIndex++;
    }, DEFAULT_INTERVAL_MS);
    return {
        stop() {
            clearInterval(timer);
            // Clear the spinner line entirely.
            process.stderr.write("\r\x1b[K");
        },
    };
}
//# sourceMappingURL=spinner.js.map