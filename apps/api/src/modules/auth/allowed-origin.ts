/** Browser origins are scheme + host + port. Subdomains and alternate ports
 * are independent security boundaries and require explicit configuration.
 * Origin-less native/server clients remain subject to authentication.
 */
export function isAllowedOrigin(origin: string | undefined, configured: string[]): boolean {
  if (!origin) return true;
  let requested: URL;
  try { requested = new URL(origin); } catch { return false; }
  if (!['http:', 'https:'].includes(requested.protocol) || requested.origin !== origin) return false;
  return configured.some((value) => {
    try {
      const allowed = new URL(value.trim());
      return ['http:', 'https:'].includes(allowed.protocol)
        && !allowed.username && !allowed.password && !allowed.search && !allowed.hash
        && allowed.pathname === '/' && allowed.origin === requested.origin;
    } catch { return false; }
  });
}
