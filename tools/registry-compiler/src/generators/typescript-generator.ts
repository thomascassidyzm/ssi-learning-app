/**
 * TypeScript Generator for Registry AST
 *
 * Generates TypeScript interfaces and enums from APML entity
 * and enum definitions.
 */

// ============================================
// AST TYPE DEFINITIONS
// ============================================

export interface FieldDefinition {
  /** Field name */
  name: string;
  /** Field type (uuid, text, integer, number, boolean, timestamp, jsonb, or enum/entity reference) */
  type: string;
  /** Whether the field is optional */
  optional?: boolean;
  /** Description for JSDoc */
  description?: string;
  /** For jsonb fields, the specific TypeScript type */
  jsonType?: string;
}

export interface EntityDefinition {
  /** Entity name (PascalCase) */
  name: string;
  /** Entity description */
  description?: string;
  /** Field definitions */
  fields: FieldDefinition[];
}

export interface EnumValue {
  /** Enum value name */
  name: string;
  /** Description for JSDoc */
  description?: string;
}

export interface EnumDefinition {
  /** Enum name (PascalCase) */
  name: string;
  /** Enum description */
  description?: string;
  /** Enum values */
  values: EnumValue[];
}

// ============================================
// TYPE MAPPING
// ============================================

const TYPE_MAP: Record<string, string> = {
  uuid: 'string',
  text: 'string',
  string: 'string',
  integer: 'number',
  int: 'number',
  number: 'number',
  float: 'number',
  boolean: 'boolean',
  bool: 'boolean',
  timestamp: 'Date',
  timestamptz: 'Date',
  jsonb: 'Record<string, unknown>',
  json: 'Record<string, unknown>',
  smallint: 'number',
  bigint: 'number',
  serial: 'number',
};

/**
 * Maps an APML type to its TypeScript equivalent
 */
function mapType(field: FieldDefinition): string {
  const apmlType = field.type;
  const lowerType = apmlType.toLowerCase();

  // Check for jsonb with specific type
  if ((lowerType === 'jsonb' || lowerType === 'json') && field.jsonType) {
    return field.jsonType;
  }

  // Handle array/list types: "list of X" or "array of X" -> X[]
  if (lowerType.startsWith('list of ') || lowerType.startsWith('array of ')) {
    const innerType = apmlType.replace(/^(list of |array of )/i, '').trim();
    const mappedInner = mapTypeString(innerType);
    return `${mappedInner}[]`;
  }

  // Handle inline enum types: "enum [a, b, c]" -> 'a' | 'b' | 'c'
  const enumMatch = apmlType.match(/^enum\s*\[([^\]]+)\]/i);
  if (enumMatch) {
    const values = enumMatch[1].split(/[,|]/).map(v => v.trim().replace(/['"]/g, ''));
    return values.map(v => `'${v}'`).join(' | ');
  }

  // Check built-in types
  if (TYPE_MAP[lowerType]) {
    return TYPE_MAP[lowerType];
  }

  // Check if it's a known enum reference (PascalCase)
  if (/^[A-Z][a-zA-Z]+$/.test(apmlType)) {
    return apmlType; // Return as-is, assuming it's a defined enum
  }

  // Default fallback
  return 'unknown';
}

/**
 * Maps a type string (for inner types in arrays)
 */
function mapTypeString(typeStr: string): string {
  const lowerType = typeStr.toLowerCase();

  if (TYPE_MAP[lowerType]) {
    return TYPE_MAP[lowerType];
  }

  // PascalCase types are references
  if (/^[A-Z][a-zA-Z]+$/.test(typeStr)) {
    return typeStr;
  }

  return 'unknown';
}

// ============================================
// CODE GENERATION HELPERS
// ============================================

/**
 * Formats a JSDoc comment block
 */
function formatJsDoc(description: string | undefined, indent: string = ''): string {
  if (!description) {
    return '';
  }
  return `${indent}/** ${description} */\n`;
}

/**
 * Generates a TypeScript enum from an EnumDefinition
 */
function generateEnum(enumDef: EnumDefinition): string {
  const lines: string[] = [];

  // Add JSDoc for enum
  if (enumDef.description) {
    lines.push(formatJsDoc(enumDef.description).trimEnd());
  }

  lines.push(`export enum ${enumDef.name} {`);

  enumDef.values.forEach((value, index) => {
    const isLast = index === enumDef.values.length - 1;
    const comma = isLast ? '' : ',';

    if (value.description) {
      lines.push(formatJsDoc(value.description, '  ').trimEnd());
    }
    lines.push(`  ${value.name} = '${value.name}'${comma}`);
  });

  lines.push('}');

  return lines.join('\n');
}

/**
 * Generates a TypeScript interface from an EntityDefinition
 */
function generateInterface(entity: EntityDefinition): string {
  const lines: string[] = [];

  // Add JSDoc for interface
  if (entity.description) {
    lines.push(formatJsDoc(entity.description).trimEnd());
  }

  lines.push(`export interface ${entity.name} {`);

  entity.fields.forEach((field) => {
    // Add field JSDoc
    if (field.description) {
      lines.push(formatJsDoc(field.description, '  ').trimEnd());
    }

    // Generate field
    const optional = field.optional ? '?' : '';
    const tsType = mapType(field);
    lines.push(`  ${field.name}${optional}: ${tsType};`);
  });

  lines.push('}');

  return lines.join('\n');
}

// ============================================
// MAIN GENERATOR FUNCTION
// ============================================

/**
 * Generates TypeScript code from Registry AST entities and enums
 *
 * @param entities - Array of EntityDefinition from the AST
 * @param enums - Array of EnumDefinition from the AST
 * @returns Generated TypeScript source code
 *
 * @example
 * ```typescript
 * const entities: EntityDefinition[] = [{
 *   name: 'User',
 *   description: 'A user in the system',
 *   fields: [
 *     { name: 'id', type: 'uuid', description: 'Unique identifier' },
 *     { name: 'email', type: 'text', description: 'User email' },
 *     { name: 'created_at', type: 'timestamp', description: 'Creation time' }
 *   ]
 * }];
 *
 * const enums: EnumDefinition[] = [{
 *   name: 'UserRole',
 *   description: 'Available user roles',
 *   values: [
 *     { name: 'Admin', description: 'Administrator' },
 *     { name: 'User', description: 'Regular user' }
 *   ]
 * }];
 *
 * const code = generateTypeScript(entities, enums);
 * ```
 */
export function generateTypeScript(
  entities: EntityDefinition[],
  enums: EnumDefinition[]
): string {
  const sections: string[] = [];

  // Add file header
  sections.push('/**');
  sections.push(' * Auto-generated TypeScript types from Registry AST');
  sections.push(' * DO NOT EDIT - Generated by registry-compiler');
  sections.push(' */');
  sections.push('');

  // Generate enums first (interfaces may reference them)
  if (enums.length > 0) {
    sections.push('// ============================================');
    sections.push('// ENUMS');
    sections.push('// ============================================');
    sections.push('');

    enums.forEach((enumDef) => {
      sections.push(generateEnum(enumDef));
      sections.push('');
    });
  }

  // Generate interfaces
  if (entities.length > 0) {
    sections.push('// ============================================');
    sections.push('// INTERFACES');
    sections.push('// ============================================');
    sections.push('');

    entities.forEach((entity) => {
      sections.push(generateInterface(entity));
      sections.push('');
    });
  }

  return sections.join('\n');
}
