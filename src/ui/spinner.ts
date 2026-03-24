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
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

export function startSpinner(label?: string): Spinner {
  // If stderr is not a TTY (e.g. piped to a file), skip animation entirely.
  if (!process.stderr.isTTY) {
    return { stop() {}, pause() {}, resume() {} };
  }

  let frameIndex = 0;
  let stopped = false;
  const prefix = label ? `${label} ` : "";
  const startTime = Date.now();

  function tick() {
    const frame = FRAMES[frameIndex % FRAMES.length];
    const elapsed = formatElapsed(Date.now() - startTime);
    // \r moves cursor to start of line; the frame overwrites previous output.
    process.stderr.write(`\r${prefix}${frame} (${elapsed})`);
    frameIndex++;
  }

  let timer: ReturnType<typeof setInterval> | null = setInterval(
    tick,
    DEFAULT_INTERVAL_MS,
  );

  function clearLine() {
    process.stderr.write("\r\x1b[K");
  }

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      clearLine();
    },
    pause() {
      if (stopped || !timer) return;
      clearInterval(timer);
      timer = null;
      clearLine();
    },
    resume() {
      if (stopped || timer) return;
      timer = setInterval(tick, DEFAULT_INTERVAL_MS);
    },
  };
}
