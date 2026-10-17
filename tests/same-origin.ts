/**
 * `init` with the Origin header a browser sends on a write to the viewer it
 * loaded from. The serve guard refuses writes without a same-server Origin, and
 * Node's fetch sends none, so tests that write add it here.
 */
export function sameOrigin(port: number, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { ...(init.headers as Record<string, string>), origin: `http://localhost:${port}` },
  };
}
