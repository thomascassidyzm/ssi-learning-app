/** Resolver half of ts-resolve-hook.mjs (runs on the loader thread). */

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (specifier.startsWith('.') && !/\.(ts|mts|js|mjs|json)$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    throw err
  }
}
