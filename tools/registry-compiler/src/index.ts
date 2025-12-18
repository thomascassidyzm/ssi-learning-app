#!/usr/bin/env node
/**
 * SSi Registry Compiler
 *
 * Compiles the SSi Variable Registry APML into:
 * - SQL migrations (Supabase/PostgreSQL)
 * - TypeScript interfaces
 *
 * Usage:
 *   npx ts-node src/index.ts <registry.apml> [--sql] [--ts] [--out <dir>]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { parseRegistry } from './parser/registry-parser';
import { generateSQL } from './generators/sql-generator';
import { generateTypeScript } from './generators/typescript-generator';

interface CompileOptions {
  sql: boolean;
  typescript: boolean;
  outDir: string;
}

function compile(inputPath: string, options: CompileOptions): void {
  console.log(`[Registry Compiler] Reading ${inputPath}...`);

  const content = readFileSync(inputPath, 'utf-8');

  console.log('[Registry Compiler] Parsing registry...');
  const ast = parseRegistry(content);

  console.log(`[Registry Compiler] Found ${ast.entities.length} entities, ${ast.enums.length} enums`);

  // Ensure output directory exists
  mkdirSync(options.outDir, { recursive: true });

  if (options.sql) {
    console.log('[Registry Compiler] Generating SQL...');

    // Filter out runtime-only entities
    const persistedEntities = ast.entities
      .filter(e => !e.runtimeOnly)
      .map(e => ({
        name: e.name,
        description: e.description,
        primary_key: e.primaryKey || 'id',
        unique_constraint: e.uniqueConstraint,
        table_name: e.tableName,
        fields: Object.fromEntries(
          e.fields.map(f => [f.name, {
            name: f.name,
            type: f.metadata.type,
            required: f.metadata.required,
            auto: f.metadata.auto,
            default: f.metadata.default,
            foreign_key: f.metadata.foreignKey,
            unique: f.metadata.unique,
          }])
        ),
      }));

    const sql = generateSQL(persistedEntities);
    const sqlPath = join(options.outDir, 'generated-schema.sql');
    writeFileSync(sqlPath, sql);
    console.log(`  ✓ ${sqlPath}`);
  }

  if (options.typescript) {
    console.log('[Registry Compiler] Generating TypeScript...');

    const entities = ast.entities.map(e => ({
      name: e.name,
      description: e.description,
      fields: e.fields.map(f => ({
        name: f.name,
        type: f.metadata.type,
        optional: !f.metadata.required,
        description: f.metadata.description,
      })),
    }));

    const enums = ast.enums.map(e => ({
      name: e.name,
      description: e.description,
      values: e.values.map(v => ({
        name: v.name,
        description: v.description,
      })),
    }));

    const ts = generateTypeScript(entities, enums);
    const tsPath = join(options.outDir, 'generated-types.ts');
    writeFileSync(tsPath, ts);
    console.log(`  ✓ ${tsPath}`);
  }

  console.log('[Registry Compiler] Done!');
}

// CLI
function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log(`
SSi Registry Compiler

Usage:
  registry-compile <registry.apml> [options]

Options:
  --sql        Generate SQL migration
  --ts         Generate TypeScript interfaces
  --out <dir>  Output directory (default: ./generated)
  --help       Show this help

Examples:
  registry-compile ssi-variable-registry.apml --sql --ts
  registry-compile registry.apml --ts --out ./src/generated
`);
    process.exit(0);
  }

  const inputPath = args[0];
  const options: CompileOptions = {
    sql: args.includes('--sql'),
    typescript: args.includes('--ts'),
    outDir: './generated',
  };

  // Parse --out option
  const outIndex = args.indexOf('--out');
  if (outIndex !== -1 && args[outIndex + 1]) {
    options.outDir = args[outIndex + 1];
  }

  // Default to both if neither specified
  if (!options.sql && !options.typescript) {
    options.sql = true;
    options.typescript = true;
  }

  try {
    compile(inputPath, options);
  } catch (error) {
    console.error('[Registry Compiler] Error:', error);
    process.exit(1);
  }
}

main();
