/**
 * Send a request over a runtime port; `fail` only when it could not be sent (no port / port gone).
 * postMessage returns undefined on success, so never chain `?? fail()` on it.
 */
export function postOrFail(
  port: { postMessage(m: unknown): void } | null,
  msg: unknown,
  fail: () => void,
) {
  try {
    if (port) port.postMessage(msg);
    else fail();
  } catch {
    fail(); // throws once the port is disconnected
  }
}
