// Bouncing-bar spinner ("Cylon eye") for indicating LLM thinking.
//
// Frames animate a lit segment bouncing left-to-right then right-to-left:
//   [    ] → [=   ] → … → [   =] → [  ==] → … → [    ] (ping-pong)
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
export function formatElapsed(ms) {
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
        return { stop() { }, pause() { }, resume() { } };
    }
    let frameIndex = 0;
    let direction = 1;
    let stopped = false;
    const prefix = label ? `${label} ` : "";
    const startTime = Date.now();
    function tick() {
        const frame = FRAMES[frameIndex];
        const elapsed = formatElapsed(Date.now() - startTime);
        // \r moves cursor to start of line; the frame overwrites previous output.
        process.stderr.write(`\r${prefix}${frame} (${elapsed})`);
        frameIndex += direction;
        if (frameIndex >= FRAMES.length - 1 || frameIndex <= 0) {
            direction *= -1;
        }
    }
    let timer = setInterval(tick, DEFAULT_INTERVAL_MS);
    function clearLine() {
        process.stderr.write("\r\x1b[K");
    }
    return {
        stop() {
            if (stopped)
                return;
            stopped = true;
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            clearLine();
        },
        pause() {
            if (stopped || !timer)
                return;
            clearInterval(timer);
            timer = null;
            clearLine();
        },
        resume() {
            if (stopped || timer)
                return;
            timer = setInterval(tick, DEFAULT_INTERVAL_MS);
        },
    };
}
//# sourceMappingURL=spinner.js.map