/**
 * AST Type Definitions for SSi Variable Registry APML Format
 *
 * This module defines TypeScript interfaces for representing the parsed
 * structure of the SSi Variable Registry APML files. The APML format is
 * a YAML-like domain-specific language for defining:
 * - Enumerations with values and metadata
 * - Entity definitions with typed fields
 * - Helper type definitions
 * - System parameters and configuration
 *
 * @module registry-ast
 * @version 1.0.0
 */

// =============================================================================
// CORE AST NODE TYPES
// =============================================================================

/**
 * Base interface for all AST nodes.
 * Provides source location tracking for error reporting.
 */
export interface ASTNode {
  /** The type discriminator for this node */
  readonly nodeType: string;
  /** Optional source location for error reporting */
  location?: SourceLocation;
}

/**
 * Source location information for error messages and debugging.
 */
export interface SourceLocation {
  /** Starting line number (1-indexed) */
  startLine: number;
  /** Starting column number (1-indexed) */
  startColumn: number;
  /** Ending line number (1-indexed) */
  endLine: number;
  /** Ending column number (1-indexed) */
  endColumn: number;
}

// =============================================================================
// REGISTRY ROOT
// =============================================================================

/**
 * Root node representing the entire registry file.
 *
 * @example
 * ```apml
 * registry SSiContent:
 *   version: "1.5.0"
 *   last_updated: "2025-12-18"
 *   # ... enums, entities, types, parameters
 * ```
 */
export interface RegistryNode extends ASTNode {
  readonly nodeType: 'registry';
  /** Registry identifier (e.g., "SSiContent") */
  name: string;
  /** Semantic version string */
  version: string;
  /** Last update date (ISO format) */
  lastUpdated: string;
  /** All enum definitions in the registry */
  enums: EnumNode[];
  /** All entity definitions in the registry */
  entities: EntityNode[];
  /** All helper type definitions */
  types: TypeNode[];
  /** All parameter sections */
  parameters: ParametersNode[];
  /** Sync strategy configuration */
  syncStrategy?: SyncStrategyNode;
  /** Compilation target configurations */
  compilation?: CompilationNode;
  /** Version history entries */
  versionHistory?: VersionHistoryNode[];
}

// =============================================================================
// ENUM DEFINITIONS
// =============================================================================

/**
 * Represents an enum definition with values and optional metadata.
 *
 * @example
 * ```apml
 * enum ContentStatus:
 *   description: "Lifecycle status for content items"
 *   values:
 *     draft:
 *       description: "In development"
 *       is_visible: false
 * ```
 */
export interface EnumNode extends ASTNode {
  readonly nodeType: 'enum';
  /** Enum identifier (e.g., "ContentStatus") */
  name: string;
  /** Human-readable description of the enum's purpose */
  description?: string;
  /** Whether this enum is only used at runtime (not persisted) */
  runtimeOnly?: boolean;
  /** Additional notes about the enum */
  notes?: string;
  /** The enum values with their metadata */
  values: EnumValueNode[];
  /** Reserved values for future use */
  futureValues?: FutureEnumValueNode[];
}

/**
 * A single value within an enum definition.
 */
export interface EnumValueNode extends ASTNode {
  readonly nodeType: 'enum_value';
  /** The enum value identifier (e.g., "draft", "released") */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Optional display name (for enums like LegoType where name differs from key) */
  displayName?: string;
  /** Arbitrary metadata properties (e.g., is_visible, threshold_ms_per_char) */
  metadata: Record<string, unknown>;
}

/**
 * A reserved/placeholder enum value for future expansion.
 */
export interface FutureEnumValueNode extends ASTNode {
  readonly nodeType: 'future_enum_value';
  /** The reserved value name */
  name: string;
  /** Comment or description for the reserved value */
  comment?: string;
}

// =============================================================================
// ENTITY DEFINITIONS
// =============================================================================

/**
 * Represents an entity (table/model) definition.
 *
 * @example
 * ```apml
 * entity Course:
 *   description: "A language course configuration"
 *   primary_key: course_code
 *   fields:
 *     course_code:
 *       type: text
 *       required: true
 * ```
 */
export interface EntityNode extends ASTNode {
  readonly nodeType: 'entity';
  /** Entity identifier (e.g., "Course", "CourseSeed") */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Primary key specification */
  primaryKey: PrimaryKeyNode;
  /** Unique constraint columns */
  uniqueConstraint?: string[];
  /** Database table name (if different from entity name) */
  tableName?: string;
  /** Whether this entity is runtime-only (not persisted) */
  runtimeOnly?: boolean;
  /** Implementation status (e.g., "designed, not yet implemented") */
  status?: string;
  /** Storage description */
  storage?: string;
  /** Additional notes about the entity */
  notes?: string;
  /** Field definitions */
  fields: FieldNode[];
  /** Derived/computed field definitions */
  derivedFields?: DerivedFieldNode[];
  /** Foreign key relationships */
  foreignKeys?: ForeignKeyNode[];
}

/**
 * Primary key specification for an entity.
 */
export interface PrimaryKeyNode extends ASTNode {
  readonly nodeType: 'primary_key';
  /** Column name(s) for the primary key */
  columns: string[];
  /** Key type hint (e.g., "UUID", "serial") */
  keyType?: string;
}

/**
 * A field definition within an entity.
 *
 * @example
 * ```apml
 * course_code:
 *   type: text
 *   required: true
 *   format: "{target_lang}_for_{known_lang}"
 *   example: "spa_for_eng"
 * ```
 */
export interface FieldNode extends ASTNode {
  readonly nodeType: 'field';
  /** Field name */
  name: string;
  /** Field type specification */
  type: FieldTypeNode;
  /** Whether the field is required */
  required: boolean;
  /** Whether the field is auto-generated */
  auto?: boolean;
  /** Default value */
  defaultValue?: unknown;
  /** Human-readable description */
  description?: string;
  /** Format specification (e.g., pattern) */
  format?: string;
  /** Example value(s) */
  example?: unknown;
  /** Value range specification */
  range?: RangeNode;
  /** Unit of measurement (e.g., "ms", "dB") */
  unit?: string;
  /** Conditional applicability */
  condition?: string;
  /** Whether the field must be unique */
  unique?: boolean;
  /** Additional notes */
  notes?: string;
  /** Foreign key reference */
  foreignKey?: string;
  /** Structure definition for JSONB fields */
  structure?: Record<string, unknown>;
  /** Potential/example fields for extensible JSONB */
  potentialFields?: string[];
}

/**
 * Type specification for a field.
 */
export interface FieldTypeNode extends ASTNode {
  readonly nodeType: 'field_type';
  /** Base type name (e.g., "text", "integer", "uuid", "timestamp") */
  baseType: string;
  /** Whether this is an array/list type */
  isArray?: boolean;
  /** Element type for arrays */
  elementType?: string;
  /** Reference to enum type */
  enumRef?: string;
  /** Reference to custom type */
  typeRef?: string;
  /** Inline enum values (for fields like `type: enum [easy, medium, hard]`) */
  inlineEnumValues?: string[];
}

/**
 * Range specification for numeric fields.
 */
export interface RangeNode extends ASTNode {
  readonly nodeType: 'range';
  /** Minimum value (inclusive) */
  min?: number;
  /** Maximum value (inclusive) */
  max?: number;
  /** Descriptive range string (e.g., "1-668 (expandable)") */
  description?: string;
}

/**
 * A computed/derived field definition.
 *
 * @example
 * ```apml
 * derived_fields:
 *   seed_id:
 *     formula: "'S' + pad(seed_number, 4, '0')"
 *     example: "S0001"
 * ```
 */
export interface DerivedFieldNode extends ASTNode {
  readonly nodeType: 'derived_field';
  /** Field name */
  name: string;
  /** Computation formula */
  formula: string;
  /** Example output */
  example?: string;
  /** Description */
  description?: string;
  /** Additional notes */
  notes?: string;
}

/**
 * Foreign key relationship definition.
 */
export interface ForeignKeyNode extends ASTNode {
  readonly nodeType: 'foreign_key';
  /** Local column name */
  column: string;
  /** Referenced entity name */
  referencedEntity: string;
  /** Referenced column name */
  referencedColumn: string;
}

// =============================================================================
// HELPER TYPE DEFINITIONS
// =============================================================================

/**
 * A helper type definition (like a struct or interface).
 *
 * @example
 * ```apml
 * type LanguagePair:
 *   description: "Text in both known and target languages"
 *   fields:
 *     known:
 *       type: text
 *       required: true
 *     target:
 *       type: text
 *       required: true
 * ```
 */
export interface TypeNode extends ASTNode {
  readonly nodeType: 'type';
  /** Type identifier */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Field definitions */
  fields: FieldNode[];
}

// =============================================================================
// PARAMETERS SECTION
// =============================================================================

/**
 * A parameters section containing system configuration values.
 *
 * @example
 * ```apml
 * parameters SSiDefaults:
 *   description: "All configurable values"
 *   course_structure:
 *     default_seed_count:
 *       value: 668
 *       type: integer
 * ```
 */
export interface ParametersNode extends ASTNode {
  readonly nodeType: 'parameters';
  /** Parameters section name (e.g., "SSiDefaults") */
  name: string;
  /** Description of the parameters section */
  description?: string;
  /** Parameter groups (e.g., "course_structure", "triple_helix") */
  groups: ParameterGroupNode[];
}

/**
 * A group of related parameters.
 */
export interface ParameterGroupNode extends ASTNode {
  readonly nodeType: 'parameter_group';
  /** Group identifier (e.g., "course_structure") */
  name: string;
  /** Group description */
  description?: string;
  /** Individual parameters in this group */
  parameters: ParameterNode[];
}

/**
 * A single parameter definition.
 */
export interface ParameterNode extends ASTNode {
  readonly nodeType: 'parameter';
  /** Parameter name */
  name: string;
  /** Parameter value */
  value: unknown;
  /** Value type (e.g., "integer", "string", "boolean") */
  type?: string;
  /** Human-readable description */
  description?: string;
  /** Additional notes */
  note?: string;
  /** Example usage */
  example?: string;
  /** Derived from another value */
  derivedFrom?: string;
  /** Rationale for the value */
  rationale?: string;
}

// =============================================================================
// SYNC STRATEGY
// =============================================================================

/**
 * Sync strategy configuration for PWA/offline support.
 */
export interface SyncStrategyNode extends ASTNode {
  readonly nodeType: 'sync_strategy';
  /** Description of the sync approach */
  description?: string;
  /** Initial load configuration */
  initialLoad?: SyncQueryNode;
  /** Delta sync configuration */
  deltaSync?: SyncQueryNode;
  /** Audio cache strategy */
  audioCache?: AudioCacheNode;
}

/**
 * A sync query configuration.
 */
export interface SyncQueryNode extends ASTNode {
  readonly nodeType: 'sync_query';
  /** Description */
  description?: string;
  /** SQL query template */
  query: string;
  /** Cache destination */
  cacheTo?: string;
  /** Merge strategy for updates */
  mergeStrategy?: string;
}

/**
 * Audio cache configuration.
 */
export interface AudioCacheNode extends ASTNode {
  readonly nodeType: 'audio_cache';
  /** Description */
  description?: string;
  /** Caching approach */
  approach?: string;
  /** How far ahead to prefetch */
  prefetchAhead?: string;
  /** Storage mechanism */
  storage?: string;
}

// =============================================================================
// COMPILATION TARGETS
// =============================================================================

/**
 * Compilation target configurations.
 */
export interface CompilationNode extends ASTNode {
  readonly nodeType: 'compilation';
  /** Supabase SQL generation config */
  supabaseSql?: CompilationTargetNode;
  /** TypeScript types generation config */
  typescriptTypes?: CompilationTargetNode;
  /** JSON Schema generation config */
  jsonSchema?: CompilationTargetNode;
  /** Legacy manifest mapping */
  legacyManifest?: LegacyManifestNode;
}

/**
 * A compilation target configuration.
 */
export interface CompilationTargetNode extends ASTNode {
  readonly nodeType: 'compilation_target';
  /** Description of the target */
  description?: string;
  /** Output file path */
  output: string;
}

/**
 * Legacy manifest mapping configuration.
 */
export interface LegacyManifestNode extends ASTNode {
  readonly nodeType: 'legacy_manifest';
  /** Description */
  description?: string;
  /** Field mappings (new name -> legacy name) */
  mappings: Record<string, string>;
}

// =============================================================================
// VERSION HISTORY
// =============================================================================

/**
 * Version history entry.
 */
export interface VersionHistoryNode extends ASTNode {
  readonly nodeType: 'version_history';
  /** Version string (e.g., "v1.5.0") */
  version: string;
  /** Release date */
  date: string;
  /** List of changes */
  changes: string[];
  /** Design rationale */
  designRationale?: string;
  /** Breaking changes */
  breakingChanges?: string[];
  /** Implementation status per component */
  implementationStatus?: Record<string, string>;
  /** Contributors */
  contributors?: string[];
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Union type of all AST node types for type guards.
 */
export type AnyASTNode =
  | RegistryNode
  | EnumNode
  | EnumValueNode
  | FutureEnumValueNode
  | EntityNode
  | PrimaryKeyNode
  | FieldNode
  | FieldTypeNode
  | RangeNode
  | DerivedFieldNode
  | ForeignKeyNode
  | TypeNode
  | ParametersNode
  | ParameterGroupNode
  | ParameterNode
  | SyncStrategyNode
  | SyncQueryNode
  | AudioCacheNode
  | CompilationNode
  | CompilationTargetNode
  | LegacyManifestNode
  | VersionHistoryNode;

/**
 * Type guard to check if a node is a specific type.
 */
export function isNodeType<T extends AnyASTNode>(
  node: AnyASTNode,
  nodeType: T['nodeType']
): node is T {
  return node.nodeType === nodeType;
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Creates a new RegistryNode with default values.
 */
export function createRegistryNode(
  name: string,
  version: string,
  lastUpdated: string
): RegistryNode {
  return {
    nodeType: 'registry',
    name,
    version,
    lastUpdated,
    enums: [],
    entities: [],
    types: [],
    parameters: [],
  };
}

/**
 * Creates a new EnumNode with default values.
 */
export function createEnumNode(name: string): EnumNode {
  return {
    nodeType: 'enum',
    name,
    values: [],
  };
}

/**
 * Creates a new EntityNode with default values.
 */
export function createEntityNode(name: string): EntityNode {
  return {
    nodeType: 'entity',
    name,
    primaryKey: {
      nodeType: 'primary_key',
      columns: ['id'],
    },
    fields: [],
  };
}

/**
 * Creates a new FieldNode with default values.
 */
export function createFieldNode(name: string, type: string): FieldNode {
  return {
    nodeType: 'field',
    name,
    type: {
      nodeType: 'field_type',
      baseType: type,
    },
    required: false,
  };
}

/**
 * Creates a new TypeNode with default values.
 */
export function createTypeNode(name: string): TypeNode {
  return {
    nodeType: 'type',
    name,
    fields: [],
  };
}

/**
 * Creates a new ParametersNode with default values.
 */
export function createParametersNode(name: string): ParametersNode {
  return {
    nodeType: 'parameters',
    name,
    groups: [],
  };
}
