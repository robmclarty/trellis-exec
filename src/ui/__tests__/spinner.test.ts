import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatElapsed, startSpinner } from "../spinner.js";

describe("formatElapsed", () => {
  it("formats 0ms as 0s", () => {
    expect(formatElapsed(0)).toBe("0s");
  });

  it("formats seconds only", () => {
    expect(formatElapsed(5000)).toBe("5s");
  });

  it("formats exact minute", () => {
    expect(formatElapsed(60_000)).toBe("1m 00s");
  });

  it("formats minutes and seconds", () => {
    expect(formatElapsed(90_000)).toBe("1m 30s");
  });

  it("pads seconds with leading zero", () => {
    expect(formatElapsed(61_000)).toBe("1m 01s");
  });
});

describe("startSpinner", () => {
  let originalIsTTY: boolean | undefined;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalIsTTY = process.stderr.isTTY;
    writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    writeSpy.mockRestore();
    Object.defineProperty(process.stderr, "isTTY", {
      value: originalIsTTY,
      configurable: true,
      writable: true,
    });
  });

  it("returns no-op spinner when stderr is not a TTY", () => {
    Object.defineProperty(process.stderr, "isTTY", {
      value: false,
      configurable: true,
      writable: true,
    });
    const spinner = startSpinner("Loading");
    vi.advanceTimersByTime(500);
    // write may be called 0 times or only for non-spinner purposes
    spinner.stop();
    spinner.pause();
    spinner.resume();
    // Should not throw
  });

  it("writes frames to stderr in TTY mode", () => {
    Object.defineProperty(process.stderr, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });
    startSpinner("Working");
    vi.advanceTimersByTime(120);

    expect(writeSpy).toHaveBeenCalled();
    const output = writeSpy.mock.calls
      .map((c) => String(c[0]))
      .join("");
    expect(output).toContain("Working");
  });

  it("stop() clears the line and stops further writes", () => {
    Object.defineProperty(process.stderr, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });
    const spinner = startSpinner();
    vi.advanceTimersByTime(120);

    spinner.stop();
    const callCountAfterStop = writeSpy.mock.calls.length;

    // The last write should be the clear sequence
    const lastWrite = String(writeSpy.mock.calls[callCountAfterStop - 1]![0]);
    expect(lastWrite).toContain("\r\x1b[K");

    // No more writes after stop
    vi.advanceTimersByTime(500);
    expect(writeSpy.mock.calls.length).toBe(callCountAfterStop);
  });

  it("stop() is idempotent", () => {
    Object.defineProperty(process.stderr, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });
    const spinner = startSpinner();
    spinner.stop();
    const countAfterFirstStop = writeSpy.mock.calls.length;
    spinner.stop();
    expect(writeSpy.mock.calls.length).toBe(countAfterFirstStop);
  });

  it("pause() stops writes and resume() restarts them", () => {
    Object.defineProperty(process.stderr, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });
    const spinner = startSpinner();
    vi.advanceTimersByTime(120);

    spinner.pause();
    const countAfterPause = writeSpy.mock.calls.length;
    vi.advanceTimersByTime(500);
    expect(writeSpy.mock.calls.length).toBe(countAfterPause);

    spinner.resume();
    vi.advanceTimersByTime(120);
    expect(writeSpy.mock.calls.length).toBeGreaterThan(countAfterPause);

    spinner.stop();
  });
});
