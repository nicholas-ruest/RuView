/**
 * Tauri runtime guard.
 *
 * The desktop pages drive hardware via Tauri's `invoke` IPC. When the UI is
 * opened in a plain browser (e.g. the Vite dev preview / Codespaces), the
 * Tauri bridge is absent and calling `invoke` throws
 * "Cannot read properties of undefined (reading 'invoke')". These helpers let
 * callers detect that and degrade gracefully instead of erroring.
 */

/** True when running inside the Tauri desktop shell (IPC available). */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/**
 * Invoke a Tauri command, or resolve to `undefined` when not running inside
 * the desktop shell (browser preview). Never throws on a missing bridge — so
 * callers can treat `undefined` as "desktop-only feature unavailable here".
 */
export async function invokeIfTauri<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | undefined> {
  if (!isTauri()) return undefined;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
