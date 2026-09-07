/**
 * FAMILY_SEAT_CAP — how many accounts an SSi Family plan covers, INCLUDING the
 * payer. Must equal the server's cap in api/_utils/familyMembership.ts, which
 * is the one that actually enforces it; this copy exists so client copy can
 * state the number without importing server code.
 */
export const FAMILY_SEAT_CAP = 6
