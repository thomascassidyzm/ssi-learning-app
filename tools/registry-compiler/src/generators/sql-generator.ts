/**
 * SQL Generator for Supabase/PostgreSQL
 *
 * Generates migrations from Registry AST (EntityDefinition[]).
 * Follows the migration style from 20251216193000_learner_tables.sql
 */

// ============================================================================
// AST Types (from Registry Parser)
// ============================================================================

export interface FieldDefinition {
  name: string;
  type: string;
  required: boolean;
  auto?: boolean;
  default?: string | number | boolean | object;
  description?: string;
  unique?: boolean;
  foreign_key?: string;
  format?: string;
  range?: string | [number, number];
  condition?: string;
}

export interface EntityDefinition {
  name: string;
  description?: string;
  primary_key: string;
  unique_constraint?: string[];
  table_name?: string;
  runtime_only?: boolean;
  fields: Record<string, FieldDefinition>;
  indexes?: IndexDefinition[];
  rls?: RLSConfig;
}

export interface IndexDefinition {
  name: string;
  columns: string[];
  unique?: boolean;
}

export interface RLSConfig {
  enabled: boolean;
  owner_column?: string;
  owner_path?: string; // e.g., "learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid())"
}

export interface GeneratorOptions {
  /** Include header comment */
  includeHeader?: boolean;
  /** Generate RLS policies */
  generateRLS?: boolean;
  /** Generate updated_at triggers */
  generateTriggers?: boolean;
  /** Schema name (default: public) */
  schema?: string;
}

// ============================================================================
// Type Mapping
// ============================================================================

/**
 * Maps APML types to PostgreSQL types
 */
function mapType(apmlType: string): string {
  // Handle parameterized types
  const lowerType = apmlType.toLowerCase();

  // Exact matches
  const typeMap: Record<string, string> = {
    uuid: "UUID",
    text: "TEXT",
    string: "TEXT",
    integer: "INTEGER",
    int: "INTEGER",
    number: "NUMERIC(10, 4)",
    float: "NUMERIC(10, 4)",
    boolean: "BOOLEAN",
    bool: "BOOLEAN",
    timestamp: "TIMESTAMPTZ",
    timestamptz: "TIMESTAMPTZ",
    jsonb: "JSONB",
    json: "JSONB",
    smallint: "SMALLINT",
    bigint: "BIGINT",
    serial: "SERIAL",
  };

  // Check for list/array types
  if (lowerType.startsWith("list of ") || lowerType.startsWith("array of ")) {
    const innerType = apmlType.replace(/^(list of |array of )/i, "");
    return `${mapType(innerType)}[]`;
  }

  // Check for enum types
  if (lowerType.startsWith("enum ") || lowerType.startsWith("enum[")) {
    // Extract enum values: enum [a, b, c] or enum [a | b | c]
    const match = apmlType.match(/enum\s*\[([^\]]+)\]/i);
    if (match) {
      const values = match[1].split(/[,|]/).map((v) => v.trim());
      // Use TEXT with CHECK constraint (generated separately)
      return "TEXT";
    }
    return "TEXT";
  }

  // Check for references (e.g., "ContentStatus", "LegoType")
  if (typeMap[lowerType]) {
    return typeMap[lowerType];
  }

  // If it's a custom type reference (like an enum name), default to TEXT
  // The actual constraint will be handled by CHECK constraints
  if (/^[A-Z][a-zA-Z]+$/.test(apmlType)) {
    return "TEXT";
  }

  // Default fallback
  return "TEXT";
}

/**
 * Extract enum values from type definition
 */
function extractEnumValues(apmlType: string): string[] | null {
  const match = apmlType.match(/enum\s*\[([^\]]+)\]/i);
  if (match) {
    return match[1].split(/[,|]/).map((v) => v.trim().replace(/['"]/g, ""));
  }
  return null;
}

/**
 * Format a default value for SQL
 */
function formatDefault(
  value: string | number | boolean | object | undefined,
  pgType: string
): string | null {
  if (value === undefined) return null;

  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    // Handle special defaults
    if (value === "" || value === "''") {
      return "''";
    }
    return `'${value.replace(/'/g, "''")}'`;
  }

  if (typeof value === "object") {
    // JSONB default
    const jsonStr = JSON.stringify(value, null, 2);
    return `'${jsonStr.replace(/'/g, "''")}'::jsonb`;
  }

  return null;
}

/**
 * Convert entity name to snake_case table name
 */
function toTableName(entityName: string): string {
  // Convert PascalCase to snake_case and pluralize
  const snake = entityName
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");

  // Simple pluralization
  if (snake.endsWith("y")) {
    return snake.slice(0, -1) + "ies";
  }
  if (
    snake.endsWith("s") ||
    snake.endsWith("x") ||
    snake.endsWith("ch") ||
    snake.endsWith("sh")
  ) {
    return snake + "es";
  }
  return snake + "s";
}

/**
 * Convert field name to snake_case column name
 */
function toColumnName(fieldName: string): string {
  return fieldName.replace(/([A-Z])/g, "_$1").toLowerCase();
}

// ============================================================================
// SQL Generation
// ============================================================================

/**
 * Generate CREATE TABLE statement for an entity
 */
function generateCreateTable(entity: EntityDefinition): string {
  const tableName = entity.table_name || toTableName(entity.name);
  const lines: string[] = [];

  lines.push(`CREATE TABLE IF NOT EXISTS ${tableName} (`);

  const columnDefs: string[] = [];
  const constraints: string[] = [];

  // Process fields
  for (const [fieldName, field] of Object.entries(entity.fields)) {
    const colName = toColumnName(fieldName);
    const pgType = mapType(field.type);

    let colDef = `  ${colName} ${pgType}`;

    // Primary key
    if (entity.primary_key.includes(fieldName)) {
      if (pgType === "UUID") {
        colDef += " PRIMARY KEY DEFAULT gen_random_uuid()";
      } else if (pgType === "SERIAL") {
        colDef += " PRIMARY KEY";
      } else if (pgType === "INTEGER" && field.auto) {
        // Auto-incrementing integer - use SERIAL instead
        colDef = `  ${colName} SERIAL PRIMARY KEY`;
      } else if (field.auto) {
        // Non-UUID auto field - generate UUID
        colDef = `  ${colName} UUID PRIMARY KEY DEFAULT gen_random_uuid()`;
      } else {
        colDef += " PRIMARY KEY";
      }
    } else {
      // NOT NULL constraint
      if (field.required) {
        colDef += " NOT NULL";
      }

      // Default value
      if (field.auto && (fieldName.includes("created") || fieldName.includes("updated"))) {
        colDef += " DEFAULT NOW()";
      } else if (field.default !== undefined) {
        const defaultVal = formatDefault(field.default, pgType);
        if (defaultVal) {
          colDef += ` DEFAULT ${defaultVal}`;
        }
      }

      // Foreign key reference
      if (field.foreign_key) {
        // Parse foreign key format: "Table.column" or "auth.users(id)"
        const fkMatch = field.foreign_key.match(/^([^.]+)\.([^(]+)(?:\(([^)]+)\))?$/);
        if (fkMatch) {
          const refTable = toTableName(fkMatch[1]);
          const refCol = fkMatch[2];
          constraints.push(
            `  FOREIGN KEY (${colName}) REFERENCES ${refTable}(${refCol}) ON DELETE CASCADE`
          );
        } else if (field.foreign_key.includes("auth.users")) {
          // Special case for auth.users
          colDef += " REFERENCES auth.users(id) ON DELETE CASCADE";
        }
      }

      // Unique constraint on single field
      if (field.unique) {
        constraints.push(`  UNIQUE(${colName})`);
      }
    }

    // Enum check constraint
    const enumValues = extractEnumValues(field.type);
    if (enumValues && enumValues.length > 0) {
      const valuesStr = enumValues.map((v) => `'${v}'`).join(", ");
      constraints.push(`  CHECK (${colName} IN (${valuesStr}))`);
    }

    // Range check constraint
    if (field.range && Array.isArray(field.range)) {
      const [min, max] = field.range;
      constraints.push(`  CHECK (${colName} BETWEEN ${min} AND ${max})`);
    }

    columnDefs.push(colDef);
  }

  // Composite unique constraint
  if (entity.unique_constraint && entity.unique_constraint.length > 0) {
    const cols = entity.unique_constraint.map(toColumnName).join(", ");
    constraints.push(`  UNIQUE(${cols})`);
  }

  // Combine columns and constraints
  const allDefs = [...columnDefs, ...constraints];
  lines.push(allDefs.join(",\n"));

  lines.push(");");

  return lines.join("\n");
}

/**
 * Generate indexes for an entity
 */
function generateIndexes(entity: EntityDefinition): string {
  const tableName = entity.table_name || toTableName(entity.name);
  const lines: string[] = [];

  if (entity.indexes) {
    for (const index of entity.indexes) {
      const cols = index.columns.map(toColumnName).join(", ");
      const unique = index.unique ? "UNIQUE " : "";
      lines.push(`CREATE ${unique}INDEX ${index.name} ON ${tableName}(${cols});`);
    }
  }

  // Auto-generate indexes for foreign keys
  for (const [fieldName, field] of Object.entries(entity.fields)) {
    if (field.foreign_key && !entity.primary_key.includes(fieldName)) {
      const colName = toColumnName(fieldName);
      const indexName = `idx_${tableName}_${colName}`;
      // Avoid duplicate index names
      if (!entity.indexes?.some((i) => i.name === indexName)) {
        lines.push(`CREATE INDEX ${indexName} ON ${tableName}(${colName});`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Detect the ownership pattern from entity fields
 * Returns null if no ownership can be detected (public table)
 */
function detectOwnershipPattern(entity: EntityDefinition): string | null {
  // Explicit RLS configuration takes precedence
  if (entity.rls?.owner_path) {
    return entity.rls.owner_path;
  }
  if (entity.rls?.owner_column) {
    const col = toColumnName(entity.rls.owner_column);
    return `auth.uid() = ${col}`;
  }

  // Auto-detect from fields
  const fields = entity.fields;

  // Direct user ownership (e.g., Learner table)
  if (fields["user_id"]) {
    return "auth.uid() = user_id";
  }

  // Indirect ownership through learner (most progress tables)
  if (fields["learner_id"]) {
    return "learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid())";
  }

  // Check for foreign key to learners
  for (const [fieldName, field] of Object.entries(fields)) {
    if (field.foreign_key?.toLowerCase().includes("learner")) {
      const col = toColumnName(fieldName);
      return `${col} IN (SELECT id FROM learners WHERE user_id = auth.uid())`;
    }
  }

  // Content tables (courses, seeds, etc.) - typically public read, admin write
  // Return null to indicate no user-specific RLS
  return null;
}

/**
 * Generate RLS policies for an entity
 */
function generateRLSPolicies(entity: EntityDefinition, options: GeneratorOptions = {}): string {
  const tableName = entity.table_name || toTableName(entity.name);
  const lines: string[] = [];

  // Determine the ownership check
  const ownerCheck = detectOwnershipPattern(entity);

  // Enable RLS
  lines.push(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;`);
  lines.push("");

  const entityLabel = entity.name
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase();

  if (ownerCheck === null) {
    // No ownership detected - generate public read policies
    // This is appropriate for content tables (courses, seeds, phrases, audio)
    lines.push(`-- Public content table - authenticated users can read`);
    lines.push(`CREATE POLICY "Authenticated users can view ${entityLabel}"`);
    lines.push(`  ON ${tableName} FOR SELECT`);
    lines.push(`  TO authenticated`);
    lines.push(`  USING (true);`);
    lines.push("");

    // Admin-only write policies (using service role)
    lines.push(`-- Admin-only write (use service role or create admin role)`);
    lines.push(`CREATE POLICY "Service role can manage ${entityLabel}"`);
    lines.push(`  ON ${tableName} FOR ALL`);
    lines.push(`  TO service_role`);
    lines.push(`  USING (true)`);
    lines.push(`  WITH CHECK (true);`);
  } else {
    // User-owned data - standard CRUD policies
    // SELECT policy
    lines.push(`CREATE POLICY "Users can view own ${entityLabel}"`);
    lines.push(`  ON ${tableName} FOR SELECT`);
    lines.push(`  USING (${ownerCheck});`);
    lines.push("");

    // INSERT policy
    lines.push(`CREATE POLICY "Users can insert own ${entityLabel}"`);
    lines.push(`  ON ${tableName} FOR INSERT`);
    lines.push(`  WITH CHECK (${ownerCheck});`);
    lines.push("");

    // UPDATE policy
    lines.push(`CREATE POLICY "Users can update own ${entityLabel}"`);
    lines.push(`  ON ${tableName} FOR UPDATE`);
    lines.push(`  USING (${ownerCheck});`);
    lines.push("");

    // DELETE policy (optional, often needed for progress data)
    lines.push(`CREATE POLICY "Users can delete own ${entityLabel}"`);
    lines.push(`  ON ${tableName} FOR DELETE`);
    lines.push(`  USING (${ownerCheck});`);
  }

  return lines.join("\n");
}

/**
 * Generate updated_at trigger for an entity
 */
function generateUpdatedAtTrigger(entity: EntityDefinition): string | null {
  // Check if entity has updated_at field
  if (!entity.fields["updated_at"]) {
    return null;
  }

  const tableName = entity.table_name || toTableName(entity.name);
  const triggerName = `update_${tableName}_updated_at`;

  const lines: string[] = [];
  lines.push(`DROP TRIGGER IF EXISTS ${triggerName} ON ${tableName};`);
  lines.push(`CREATE TRIGGER ${triggerName}`);
  lines.push(`  BEFORE UPDATE ON ${tableName}`);
  lines.push(`  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`);

  return lines.join("\n");
}

/**
 * Generate the update_updated_at_column function
 */
function generateUpdatedAtFunction(): string {
  return `-- Trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`;
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Generate complete SQL migration from entity definitions
 */
export function generateSQL(
  entities: EntityDefinition[],
  options: GeneratorOptions = {}
): string {
  const {
    includeHeader = true,
    generateRLS = true,
    generateTriggers = true,
  } = options;

  const sections: string[] = [];

  // Filter out runtime-only entities
  const dbEntities = entities.filter((e) => !e.runtime_only);

  // Header
  if (includeHeader) {
    sections.push(`-- SSi Learning App Database Schema
-- Generated from Registry AST
-- Supabase PostgreSQL`);
  }

  // Generate function for updated_at triggers (once at the top)
  if (generateTriggers) {
    const hasUpdatedAt = dbEntities.some((e) => e.fields["updated_at"]);
    if (hasUpdatedAt) {
      sections.push("");
      sections.push("-- ============================================");
      sections.push("-- FUNCTIONS");
      sections.push("-- ============================================");
      sections.push("");
      sections.push(generateUpdatedAtFunction());
    }
  }

  // Generate tables
  for (const entity of dbEntities) {
    const entityLabel = entity.name.replace(/([A-Z])/g, " $1").trim().toUpperCase();

    sections.push("");
    sections.push("-- ============================================");
    sections.push(`-- ${entityLabel}`);
    sections.push("-- ============================================");
    sections.push("");

    // CREATE TABLE
    sections.push(generateCreateTable(entity));

    // Indexes
    const indexes = generateIndexes(entity);
    if (indexes) {
      sections.push("");
      sections.push(indexes);
    }

    // RLS policies
    if (generateRLS) {
      sections.push("");
      sections.push("-- RLS");
      sections.push(generateRLSPolicies(entity));
    }

    // Updated_at trigger
    if (generateTriggers) {
      const trigger = generateUpdatedAtTrigger(entity);
      if (trigger) {
        sections.push("");
        sections.push(trigger);
      }
    }
  }

  return sections.join("\n");
}

/**
 * Generate SQL for a single entity
 */
export function generateEntitySQL(
  entity: EntityDefinition,
  options: GeneratorOptions = {}
): string {
  return generateSQL([entity], { ...options, includeHeader: false });
}

// ============================================================================
// Utility Exports
// ============================================================================

export { mapType, toTableName, toColumnName, formatDefault };
