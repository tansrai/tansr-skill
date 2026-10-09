import type { IncomingMessage } from 'node:http';

/** Local HTTP boundary only; identity and ticket validation remain in the original auth handlers. */
export function isLocalServiceRequest(req: IncomingMessage): boolean {
  const count = (name: string): number => {
    let total = 0;
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      if (req.rawHeaders[index]?.toLowerCase() === name) total++;
    }
    return total;
  };
  const host = req.headers.host;
  // A loopback bind alone does not reject a domain that DNS-rebinds to this listener.
  if (typeof host !== 'string' || count('host') !== 1 ||
      !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]{1,5})?$/i.test(host)) return false;
  let local: URL;
  try { local = new URL(`http://${host}`); } catch { return false; }
  if (Number(local.port || 80) !== req.socket.localPort) return false;
  const origin = req.headers.origin;
  // Native Node/mobile clients do not send Origin; browsers must address this same service.
  if (origin === undefined) return count('origin') === 0;
  if (typeof origin !== 'string' || count('origin') !== 1) return false;
  try {
    const caller = new URL(origin);
    return caller.origin === local.origin && caller.protocol === 'http:' &&
      !caller.username && !caller.password && caller.pathname === '/' && !caller.search && !caller.hash;
  } catch { return false; }
}
