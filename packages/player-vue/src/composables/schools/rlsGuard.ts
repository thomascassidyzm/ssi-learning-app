/**
 * rlsGuard - client-side scope assertion for schools data
 *
 * Supabase RLS is the primary defense against cross-school data leaks —
 * but RLS is a policy that can regress: a dashboard migration, a policy
 * rename, a service-role key mistakenly used on the client. This module
 * adds a cheap belt-and-suspenders check so we hear about it immediately
 * instead of learning from a support ticket.
 *
 * Usage:
 *   const rows = await client.from('classes').select('id, school_id').eq(...)
 *   const safe = assertScope(rows.data, 'school_id', allowedSchoolIds, {
 *     table: 'classes', caller: 'useClassesData.fetchClasses',
 *   })
 *
 * In production we filter the offending rows out and log loudly so the
 * user sees correct data while the issue surfaces in Sentry / console.
 * In development (DEV or vitest) we throw so CI catches the regression.
 */

type Scalar = string | number | null | undefined

export interface ScopeContext {
  /** Table or view name, for diagnostics */
  table: string
  /** Calling composable + function, e.g. 'useClassesData.fetchClasses' */
  caller: string
}

function isDev(): boolean {
  try {
    // Vite sets import.meta.env.DEV; vitest sets NODE_ENV === 'test'
    const env = (import.meta as unknown as { env?: { DEV?: boolean; MODE?: string } }).env
    if (env?.DEV) return true
    if (env?.MODE === 'test') return true
  } catch {
    // import.meta access can throw in some runtimes
  }
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') return true
  return false
}

/**
 * Assert that every row's `scopeKey` column value is in `allowed`.
 *
 * - Returns the filtered (safe) subset.
 * - Logs an RLS_VIOLATION error to console with the offending row IDs
 *   and caller context, so it's trivially grep-able in logs.
 * - In dev / test, throws so the regression fails loudly in CI.
 *
 * If `allowed` is an empty array, the function treats any row as out of
 * scope (returning []). That matches the intuition that "no allowed
 * schools means no visible rows."
 */
export function assertScope<T extends Record<string, unknown>>(
  rows: T[] | null | undefined,
  scopeKey: keyof T & string,
  allowed: Scalar[],
  ctx: ScopeContext
): T[] {
  if (!rows || rows.length === 0) return []

  const allowedSet = new Set(allowed.filter((v): v is string | number => v !== null && v !== undefined))

  const violations: Array<{ id: unknown; value: unknown }> = []
  const safe: T[] = []

  for (const row of rows) {
    const value = row[scopeKey] as Scalar
    if (value === null || value === undefined || !allowedSet.has(value as string | number)) {
      violations.push({ id: (row as Record<string, unknown>).id, value })
    } else {
      safe.push(row)
    }
  }

  if (violations.length > 0) {
    const msg =
      `[RLS_VIOLATION] ${ctx.caller} got ${violations.length}/${rows.length} rows ` +
      `from ${ctx.table} with ${scopeKey} outside allowed scope. ` +
      `First offender: ${JSON.stringify(violations[0])}`
    console.error(msg, { allowed: Array.from(allowedSet), violations: violations.slice(0, 5) })

    if (isDev()) {
      throw new Error(msg)
    }
  }

  return safe
}
