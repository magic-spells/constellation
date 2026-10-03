/**
 * The SessionStart hook hands its JSON on stdin — `source` is `startup`,
 * `resume`, `clear` or `compact`. `constellation working` reads it only when
 * stdin is not a TTY, and only briefly: a manual run (or `!` in Claude Code)
 * must still just print, and a pipe nobody closes must not hang the hook.
 */

/** Never wait on stdin longer than this; the hook writes and closes at once. */
export const HOOK_INPUT_TIMEOUT_MS = 300;
const MAX_INPUT_CHARS = 64 * 1024;

type InputStream = NodeJS.ReadableStream & { isTTY?: boolean; destroy?: () => void };

/** `source` from the hook's JSON, or null for anything empty, invalid or unexpected. */
export function parseHookSource(raw: string): string | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const source = (parsed as { source?: unknown }).source;
    return typeof source === 'string' ? source : null;
  } catch {
    return null;
  }
}

/** Read the hook's `source` from stdin. Null on a TTY, empty or invalid input, or a timeout. */
export async function readHookSource(
  stream: InputStream = process.stdin,
  timeoutMs = HOOK_INPUT_TIMEOUT_MS,
): Promise<string | null> {
  if (stream.isTTY) return null;
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = (timedOut: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      // An open pipe would keep the process alive after we print.
      if (timedOut) stream.destroy?.();
      else stream.pause();
      resolve(parseHookSource(data));
    };
    const onData = (chunk: Buffer | string) => {
      data += chunk.toString();
      if (data.length > MAX_INPUT_CHARS) finish(true);
    };
    const onEnd = () => finish(false);
    const onError = () => finish(true);
    const timer = setTimeout(() => finish(true), timeoutMs);
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
  });
}
