/**
 * Outbound identity propagation. The caller was already resolved by JwtGuard
 * (which stamps x-user-email / x-user-roles onto the inbound headers), so a
 * downstream service reuses those instead of re-decoding the token. The
 * original bearer header still travels too — not for the downstream guard,
 * but for the callee's Envoy PEP sidecar, which verifies the signature via
 * OPA ext_authz on every hop (the single point where authentication actually
 * happens; see ARCHITECTURE.md "Auth & Authz").
 */
export function forwardAuthHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  const pick = (name: string) => {
    const value = headers[name];
    if (typeof value === 'string') out[name] = value;
  };
  // Resolved identity, stamped by JwtGuard
  pick('x-user-email');
  pick('x-user-roles');
  // Original credential — required by the downstream Envoy PEP
  pick('cf-token');
  pick('x-amzn-oidc-data');
  pick('authorization');
  // AUTH_DISABLED test bypass — propagate so the downstream stub authenticates as the same test user
  pick('x-test-user-email');
  return out;
}
