/**
 * SSi Variable Registry APML Parser
 *
 * Parses the YAML-like indented syntax of ssi-variable-registry.apml
 * into a structured AST for code generation.
 *
 * Focuses on entity and enum definitions - the critical structures
 * for TypeScript type generation and Supabase schema generation.
 */

// =============================================================================
// AST Types
// =============================================================================

export interface FieldMetadata {
  type: string;
  required: boolean;
  default?: string;
  description?: string;
  foreignKey?: string;
  auto?: boolean;
  unique?: boolean;
  format?: string;
  example?: string;
  range?: string;
  condition?: string;
  notes?: string;
  unit?: string;
}

export interface EntityField {
  name: string;
  metadata: FieldMetadata;
}

export interface DerivedField {
  name: string;
  formula: string;
  example?: string;
  description?: string;
  notes?: string;
}

export interface EntityDefinition {
  name: string;
  description?: string;
  primaryKey?: string;
  uniqueConstraint?: string[];
  tableName?: string;
  runtimeOnly?: boolean;
  status?: string;
  notes?: string;
  fields: EntityField[];
  derivedFields?: DerivedField[];
}

export interface EnumValue {
  name: string;
  description?: string;
  metadata: Record<string, unknown>;
}

export interface EnumDefinition {
  name: string;
  description?: string;
  runtimeOnly?: boolean;
  notes?: string;
  values: EnumValue[];
  futureValues?: string[];
}

export interface TypeDefinition {
  name: string;
  description?: string;
  fields: EntityField[];
}

export interface RegistryAST {
  registryName: string;
  version?: string;
  lastUpdated?: string;
  entities: EntityDefinition[];
  enums: EnumDefinition[];
  types: TypeDefinition[];
}

// =============================================================================
// Parser Implementation
// =============================================================================

interface ParsedLine {
  indent: number;
  content: string;
  lineNumber: number;
}

/**
 * Parse the SSi Variable Registry APML format into AST
 */
export function parseRegistry(content: string): RegistryAST {
  const lines = content.split('\n');
  const parsedLines = lines.map((line, index) => parseLine(line, index + 1));

  const ast: RegistryAST = {
    registryName: '',
    entities: [],
    enums: [],
    types: [],
  };

  let i = 0;

  while (i < parsedLines.length) {
    const line = parsedLines[i];

    // Skip empty lines and comments
    if (!line.content || line.content.startsWith('#')) {
      i++;
      continue;
    }

    // Parse registry header - just extract metadata, don't skip content
    const registryMatch = line.content.match(/^registry\s+(\w+):/);
    if (registryMatch) {
      ast.registryName = registryMatch[1];
      // Look ahead for version and last_updated on immediate next lines
      for (let j = i + 1; j < Math.min(i + 5, parsedLines.length); j++) {
        const nextLine = parsedLines[j];
        if (!nextLine.content) continue;
        if (nextLine.content.startsWith('version:')) {
          ast.version = extractStringValue(nextLine.content);
        } else if (nextLine.content.startsWith('last_updated:')) {
          ast.lastUpdated = extractStringValue(nextLine.content);
        }
      }
      // Don't skip - continue parsing nested content
      i++;
      continue;
    }

    // Parse enum definition (can be at any indent level)
    const enumMatch = line.content.match(/^enum\s+(\w+):/);
    if (enumMatch) {
      const enumDef = parseEnum(parsedLines, i, enumMatch[1]);
      ast.enums.push(enumDef.definition);
      i = enumDef.endIndex + 1;
      continue;
    }

    // Parse entity definition (can be at any indent level)
    const entityMatch = line.content.match(/^entity\s+(\w+):/);
    if (entityMatch) {
      const entityDef = parseEntity(parsedLines, i, entityMatch[1]);
      ast.entities.push(entityDef.definition);
      i = entityDef.endIndex + 1;
      continue;
    }

    // Parse type definition (can be at any indent level)
    const typeMatch = line.content.match(/^type\s+(\w+):/);
    if (typeMatch) {
      const typeDef = parseType(parsedLines, i, typeMatch[1]);
      ast.types.push(typeDef.definition);
      i = typeDef.endIndex + 1;
      continue;
    }

    // Parse parameters section (can be at any indent level)
    const paramsMatch = line.content.match(/^parameters\s+(\w+):/);
    if (paramsMatch) {
      // Skip parameters section for now - just move past it
      const block = extractBlock(parsedLines, i);
      i = block.endIndex + 1;
      continue;
    }

    i++;
  }

  return ast;
}

/**
 * Parse a single line into indent level and content
 */
function parseLine(line: string, lineNumber: number): ParsedLine {
  const trimmed = line.trimStart();
  const indent = line.length - trimmed.length;
  return {
    indent,
    content: trimmed,
    lineNumber,
  };
}

/**
 * Extract a block of lines at a consistent indentation level
 */
function extractBlock(
  lines: ParsedLine[],
  startIndex: number
): ParsedLine[] & { endIndex: number } {
  const startLine = lines[startIndex];
  const baseIndent = startLine.indent;
  const block: ParsedLine[] = [startLine];
  let endIndex = startIndex;

  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];

    // Empty lines or comments within block
    if (!line.content || line.content.startsWith('#')) {
      block.push(line);
      endIndex = i;
      continue;
    }

    // If we're back to same or less indent, block is done
    if (line.indent <= baseIndent) {
      break;
    }

    block.push(line);
    endIndex = i;
  }

  const result = block as ParsedLine[] & { endIndex: number };
  result.endIndex = endIndex;
  return result;
}

/**
 * Parse simple key: value pairs from a block
 */
function parseBlockMetadata(
  lines: ParsedLine[]
): Record<string, string | boolean | number> {
  const metadata: Record<string, string | boolean | number> = {};

  for (const line of lines) {
    if (!line.content || line.content.startsWith('#')) continue;

    const match = line.content.match(/^(\w+):\s*(.*)$/);
    if (match) {
      const key = match[1];
      let value: string | boolean | number = match[2].trim();

      // Remove quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      // Parse booleans
      if (value === 'true') value = true;
      else if (value === 'false') value = false;

      metadata[key] = value;
    }
  }

  return metadata;
}

/**
 * Parse an enum definition
 */
function parseEnum(
  lines: ParsedLine[],
  startIndex: number,
  name: string
): { definition: EnumDefinition; endIndex: number } {
  const block = extractBlock(lines, startIndex);
  const definition: EnumDefinition = {
    name,
    values: [],
  };

  let i = 1; // Skip the enum header line
  while (i < block.length) {
    const line = block[i];

    if (!line.content || line.content.startsWith('#')) {
      i++;
      continue;
    }

    // Parse description
    if (line.content.startsWith('description:')) {
      definition.description = extractStringValue(line.content);
      i++;
      continue;
    }

    // Parse runtime_only
    if (line.content.startsWith('runtime_only:')) {
      definition.runtimeOnly = line.content.includes('true');
      i++;
      continue;
    }

    // Parse notes
    if (line.content.startsWith('notes:')) {
      definition.notes = extractStringValue(line.content);
      i++;
      continue;
    }

    // Parse values block
    if (line.content === 'values:') {
      const valuesResult = parseEnumValues(block, i + 1);
      definition.values = valuesResult.values;
      i = valuesResult.endIndex;
      continue;
    }

    // Parse future_values block (just skip it for now)
    if (line.content === 'future_values:') {
      // Skip the future_values block
      const indent = line.indent;
      i++;
      while (i < block.length && (block[i].indent > indent || !block[i].content)) {
        i++;
      }
      continue;
    }

    i++;
  }

  return { definition, endIndex: block.endIndex };
}

/**
 * Parse enum values from a values: block
 */
function parseEnumValues(
  lines: ParsedLine[],
  startIndex: number
): { values: EnumValue[]; endIndex: number } {
  const values: EnumValue[] = [];
  const valuesIndent = lines[startIndex]?.indent ?? 0;
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];

    // Check if we've exited the values block
    if (line.content && !line.content.startsWith('#') && line.indent < valuesIndent) {
      break;
    }

    // Skip empty lines and comments
    if (!line.content || line.content.startsWith('#')) {
      i++;
      continue;
    }

    // Look for value name (e.g., "draft:" or "source:")
    const valueMatch = line.content.match(/^(\w+):$/);
    if (valueMatch && line.indent === valuesIndent) {
      const valueName = valueMatch[1];
      const metadata: Record<string, unknown> = {};

      // Parse the value's metadata
      i++;
      while (i < lines.length) {
        const metaLine = lines[i];

        if (!metaLine.content || metaLine.content.startsWith('#')) {
          i++;
          continue;
        }

        if (metaLine.indent <= valuesIndent) {
          break;
        }

        const metaMatch = metaLine.content.match(/^(\w+):\s*(.*)$/);
        if (metaMatch) {
          const key = metaMatch[1];
          let value: string | boolean | number | null = metaMatch[2].trim();

          // Handle multi-line values (like composite_structure)
          if (value === '|') {
            const multiLineValue: string[] = [];
            i++;
            const multiLineIndent = lines[i]?.indent ?? 0;
            while (i < lines.length && lines[i].indent >= multiLineIndent) {
              multiLineValue.push(lines[i].content);
              i++;
            }
            metadata[key] = multiLineValue.join('\n');
            continue;
          }

          // Remove quotes
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }

          // Parse booleans
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (value === 'null') value = null;
          // Parse numbers
          else if (/^-?\d+$/.test(value)) value = parseInt(value, 10);
          else if (/^-?\d+\.\d+$/.test(value)) value = parseFloat(value);

          metadata[key] = value;
        }
        i++;
      }

      values.push({
        name: valueName,
        description: metadata['description'] as string | undefined,
        metadata,
      });
      continue;
    }

    i++;
  }

  return { values, endIndex: i };
}

/**
 * Parse an entity definition
 */
function parseEntity(
  lines: ParsedLine[],
  startIndex: number,
  name: string
): { definition: EntityDefinition; endIndex: number } {
  const block = extractBlock(lines, startIndex);
  const definition: EntityDefinition = {
    name,
    fields: [],
  };

  let i = 1; // Skip the entity header line
  while (i < block.length) {
    const line = block[i];

    if (!line.content || line.content.startsWith('#')) {
      i++;
      continue;
    }

    // Parse description
    if (line.content.startsWith('description:')) {
      definition.description = extractStringValue(line.content);
      i++;
      continue;
    }

    // Parse primary_key
    if (line.content.startsWith('primary_key:')) {
      definition.primaryKey = extractValue(line.content);
      i++;
      continue;
    }

    // Parse unique_constraint
    if (line.content.startsWith('unique_constraint:')) {
      const constraintStr = extractValue(line.content);
      // Parse [field1, field2] format
      const match = constraintStr.match(/\[(.*)\]/);
      if (match) {
        definition.uniqueConstraint = match[1].split(',').map((s) => s.trim());
      }
      i++;
      continue;
    }

    // Parse table_name
    if (line.content.startsWith('table_name:')) {
      definition.tableName = extractStringValue(line.content);
      i++;
      continue;
    }

    // Parse runtime_only
    if (line.content.startsWith('runtime_only:')) {
      definition.runtimeOnly = line.content.includes('true');
      i++;
      continue;
    }

    // Parse status
    if (line.content.startsWith('status:')) {
      definition.status = extractStringValue(line.content);
      i++;
      continue;
    }

    // Parse notes (can be multi-line)
    if (line.content.startsWith('notes:')) {
      const value = extractValue(line.content);
      if (value === '|') {
        // Multi-line notes
        const notesLines: string[] = [];
        i++;
        const notesIndent = block[i]?.indent ?? 0;
        while (i < block.length && (block[i].indent >= notesIndent || !block[i].content)) {
          if (block[i].content) {
            notesLines.push(block[i].content);
          }
          i++;
        }
        definition.notes = notesLines.join('\n');
        continue;
      } else {
        definition.notes = extractStringValue(line.content);
        i++;
        continue;
      }
    }

    // Parse fields block
    if (line.content === 'fields:') {
      const fieldsResult = parseEntityFields(block, i + 1);
      definition.fields = fieldsResult.fields;
      i = fieldsResult.endIndex;
      continue;
    }

    // Parse derived_fields block
    if (line.content === 'derived_fields:') {
      const derivedResult = parseDerivedFields(block, i + 1);
      definition.derivedFields = derivedResult.fields;
      i = derivedResult.endIndex;
      continue;
    }

    // Skip storage, natural_key, etc.
    i++;
  }

  return { definition, endIndex: block.endIndex };
}

/**
 * Parse entity fields from a fields: block
 */
function parseEntityFields(
  lines: ParsedLine[],
  startIndex: number
): { fields: EntityField[]; endIndex: number } {
  const fields: EntityField[] = [];
  const fieldsIndent = lines[startIndex]?.indent ?? 0;
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];

    // Check if we've exited the fields block
    if (line.content && !line.content.startsWith('#') && line.indent < fieldsIndent) {
      break;
    }

    // Skip empty lines and comments
    if (!line.content || line.content.startsWith('#')) {
      i++;
      continue;
    }

    // Look for field name (e.g., "course_code:")
    const fieldMatch = line.content.match(/^(\w+):$/);
    if (fieldMatch && line.indent === fieldsIndent) {
      const fieldName = fieldMatch[1];
      const metadata: FieldMetadata = {
        type: 'unknown',
        required: false,
      };

      // Parse the field's metadata
      i++;
      while (i < lines.length) {
        const metaLine = lines[i];

        if (!metaLine.content || metaLine.content.startsWith('#')) {
          i++;
          continue;
        }

        if (metaLine.indent <= fieldsIndent) {
          break;
        }

        const metaMatch = metaLine.content.match(/^(\w+):\s*(.*)$/);
        if (metaMatch) {
          const key = metaMatch[1];
          let value = metaMatch[2].trim();

          // Remove quotes
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }

          switch (key) {
            case 'type':
              metadata.type = value;
              break;
            case 'required':
              metadata.required = value === 'true';
              break;
            case 'default':
              metadata.default = value;
              break;
            case 'description':
              metadata.description = value;
              break;
            case 'foreign_key':
              metadata.foreignKey = value;
              break;
            case 'auto':
              metadata.auto = value === 'true';
              break;
            case 'unique':
              metadata.unique = value === 'true';
              break;
            case 'format':
              metadata.format = value;
              break;
            case 'example':
              metadata.example = value;
              break;
            case 'range':
              metadata.range = value;
              break;
            case 'condition':
              metadata.condition = value;
              break;
            case 'notes':
              metadata.notes = value;
              break;
            case 'unit':
              metadata.unit = value;
              break;
          }
        }
        i++;
      }

      fields.push({
        name: fieldName,
        metadata,
      });
      continue;
    }

    i++;
  }

  return { fields, endIndex: i };
}

/**
 * Parse derived fields from a derived_fields: block
 */
function parseDerivedFields(
  lines: ParsedLine[],
  startIndex: number
): { fields: DerivedField[]; endIndex: number } {
  const fields: DerivedField[] = [];
  const derivedIndent = lines[startIndex]?.indent ?? 0;
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];

    // Check if we've exited the derived_fields block
    if (line.content && !line.content.startsWith('#') && line.indent < derivedIndent) {
      break;
    }

    // Skip empty lines and comments
    if (!line.content || line.content.startsWith('#')) {
      i++;
      continue;
    }

    // Look for field name
    const fieldMatch = line.content.match(/^(\w+):$/);
    if (fieldMatch && line.indent === derivedIndent) {
      const fieldName = fieldMatch[1];
      let formula = '';
      let example: string | undefined;
      let description: string | undefined;
      let notes: string | undefined;

      // Parse the field's metadata
      i++;
      while (i < lines.length) {
        const metaLine = lines[i];

        if (!metaLine.content || metaLine.content.startsWith('#')) {
          i++;
          continue;
        }

        if (metaLine.indent <= derivedIndent) {
          break;
        }

        const metaMatch = metaLine.content.match(/^(\w+):\s*(.*)$/);
        if (metaMatch) {
          const key = metaMatch[1];
          let value = metaMatch[2].trim();

          // Remove quotes
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }

          switch (key) {
            case 'formula':
              formula = value;
              break;
            case 'example':
              example = value;
              break;
            case 'description':
              description = value;
              break;
            case 'notes':
              notes = value;
              break;
          }
        }
        i++;
      }

      fields.push({
        name: fieldName,
        formula,
        example,
        description,
        notes,
      });
      continue;
    }

    i++;
  }

  return { fields, endIndex: i };
}

/**
 * Parse a type definition (helper types like LanguagePair)
 */
function parseType(
  lines: ParsedLine[],
  startIndex: number,
  name: string
): { definition: TypeDefinition; endIndex: number } {
  const block = extractBlock(lines, startIndex);
  const definition: TypeDefinition = {
    name,
    fields: [],
  };

  let i = 1;
  while (i < block.length) {
    const line = block[i];

    if (!line.content || line.content.startsWith('#')) {
      i++;
      continue;
    }

    // Parse description
    if (line.content.startsWith('description:')) {
      definition.description = extractStringValue(line.content);
      i++;
      continue;
    }

    // Parse fields block
    if (line.content === 'fields:') {
      const fieldsResult = parseEntityFields(block, i + 1);
      definition.fields = fieldsResult.fields;
      i = fieldsResult.endIndex;
      continue;
    }

    i++;
  }

  return { definition, endIndex: block.endIndex };
}

/**
 * Extract value from a "key: value" line
 */
function extractValue(line: string): string {
  const match = line.match(/^[\w_]+:\s*(.*)$/);
  return match ? match[1].trim() : '';
}

/**
 * Extract string value, removing quotes
 */
function extractStringValue(line: string): string {
  let value = extractValue(line);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}
