# API Endpoints Reference

> Auto-generated from codebase audit 2026-04-10. Keep this in sync with actual API files.

## Audio

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/audio/:audioId` | GET | No | Proxy audio from S3 via `course_audio` table lookup |

- Queries `course_audio.id` to get `s3_key`, streams from S3
- Logs to `audio_plays` (fire-and-forget)
- Sets `Cache-Control: public, max-age=31536000, immutable` on success only
- Error responses get `Cache-Control: no-store`

## Code Redemption (Unified)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/code/validate` | POST | No | Validate invite or entitlement code |
| `/api/code/redeem` | POST | Yes | Redeem invite or entitlement code |

- Accepts `{ code, codeKind: 'invite' | 'entitlement' }`
- Invite codes: assigns roles, creates user_tags, handles school_admin_join
- Entitlement codes: creates user_entitlements row

## Invite Codes (Legacy — use /api/code/* instead)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/invite/validate` | POST | No | Validate invite code |
| `/api/invite/redeem` | POST | Yes | Redeem invite code |
| `/api/invite/create` | POST | Yes | Create new invite code |

## Entitlements

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/entitlement/user` | GET | Yes | Get current user's entitlements |
| `/api/entitlement/list` | GET | ssi_admin | List all entitlement codes |
| `/api/entitlement/create` | POST | ssi_admin | Create entitlement code |
| `/api/entitlement/grant` | POST | Yes | Create/update entitlement grant |
| `/api/entitlement/grants` | GET | Yes | List entitlement grants |

## Groups

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/groups` | GET | ssi_admin | List all groups with school counts |
| `/api/groups` | POST | ssi_admin | Create group |
| `/api/groups/:id` | PATCH | ssi_admin | Update group |
| `/api/groups/:id` | DELETE | ssi_admin | Delete group |

## Admin

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/admin/grant-entitlement` | POST | ssi_admin | Direct entitlement grant |
| `/api/admin/revoke-entitlement` | POST | ssi_admin | Revoke entitlement |

## Subscriptions (LemonSqueezy)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/subscription` | GET | Yes | Get subscription status |
| `/api/subscription/checkout` | POST | Yes | Start checkout |
| `/api/subscription/portal` | POST | Yes | Get customer portal URL |
| `/api/subscription/webhook` | POST | No (webhook secret) | Handle LS webhooks |

## Email

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/email/verify` | POST | Yes | Verify email OTP server-side |

## Environment Variables

All API endpoints use these (with `.trim()` on all values):

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` / `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (bypasses RLS) |
| `VITE_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY` | Anonymous key |
| `AWS_ACCESS_KEY_ID` | S3 access key |
| `AWS_SECRET_ACCESS_KEY` | S3 secret key |
| `AWS_REGION` / `VITE_S3_REGION` | S3 region (default: eu-west-1) |
| `S3_AUDIO_BUCKET` / `VITE_S3_AUDIO_BUCKET` | S3 bucket name |
| `LEMONSQUEEZY_API_KEY` | LemonSqueezy API key |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | Webhook signature verification |
