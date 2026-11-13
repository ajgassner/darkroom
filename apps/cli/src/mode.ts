// How the CLI was asked to run (decided once at start, before any output is set up) and its exit codes.
// No imports: no-color.ts reads this before picocolors decides about colors.

/**
 * Whether the command line asks for JSON output: `--json` before a `--` (after it, everything is prompt text). The
 * commands that take --json declare it; elsewhere commander rejects it, and that error is JSON then too.
 */
export function jsonRequested(args: readonly string[]): boolean {
  const end = args.indexOf('--');
  return (end < 0 ? args : args.slice(0, end)).includes('--json');
}

/**
 * --json: exactly one JSON document on stdout, no prompts, no interactive mode and no clack frames (progress
 * still goes to stderr as plain lines).
 */
export const jsonMode = jsonRequested(process.argv.slice(2));

/** Exit codes (the skill guide lists them). */
export const EXIT = {
  /** Everything worked, or a run delivered at least one result (partial success). */
  ok: 0,
  /** A run delivered only errors, the input was invalid or the command failed. */
  failed: 1,
  /** Cancelled (Ctrl+C, Escape on the first question, SIGTERM), as in a shell. */
  cancelled: 130,
} as const;
