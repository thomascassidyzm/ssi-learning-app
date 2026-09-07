/**
 * Fake-but-shaped access tokens for the API test suites.
 *
 * Since job #345 the minting paths READ the token they are about to hand out —
 * `session_id` is what marks the mint unclaimed (api/_utils/unclaimedMint.ts).
 * An opaque 'at-1' string therefore no longer stands in for a session, and a
 * mock that hands one back is testing a shape the code can never see. This
 * builds the real shape: an unsigned JWT whose payload carries the claims the
 * handlers read. It is never verified by anything — verification is GoTrue's
 * job and these never leave the test process.
 */
export function fakeAccessToken(
  claims: { session_id?: string; sub?: string; amr?: Array<{ method: string }> } = {},
): string {
  const payload = {
    sub: claims.sub ?? 'user-1',
    session_id: claims.session_id ?? 'session-1',
    amr: claims.amr ?? [{ method: 'otp' }],
  }
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.sig`
}
