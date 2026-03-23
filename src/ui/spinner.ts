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
}

/**
 * Start a bouncing-bar spinner on stderr with an optional label.
 *
 * The spinner writes to stderr so it never contaminates captured stdout.
 * Calling `stop()` clears the line and restores the cursor.
 */
export function startSpinner(label?: string): Spinner {
  // If stderr is not a TTY (e.g. piped to a file), skip animation entirely.
  if (!process.stderr.isTTY) {
    return { stop() {} };
  }

  let frameIndex = 0;
  const prefix = label ? `${label} ` : "";

  const timer = setInterval(() => {
    const frame = FRAMES[frameIndex % FRAMES.length];
    // \r moves cursor to start of line; the frame overwrites previous output.
    process.stderr.write(`\r${prefix}${frame}`);
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
