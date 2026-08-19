/**
 * Every service in this platform globally guards its routes (APP_GUARD ->
 * JwtGuard) and independently verifies the Cognito JWT — a BFF calling
 * downstream must forward the caller's own credential, not mint its own.
 * Picks whichever of the guard's accepted header forms the inbound request
 * actually carried and re-sends it verbatim on the outbound call.
 */
export function forwardAuthHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  const pick = (name: string) => {
    const value = headers[name];
    if (typeof value === 'string') out[name] = value;
  };
  pick('cf-token');
  pick('x-amzn-oidc-data');
  pick('authorization');
  // AUTH_DISABLED test bypass — propagate so the downstream stub authenticates as the same test user
  pick('x-test-user-email');
  return out;
}
