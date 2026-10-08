import type { ProviderCapabilities } from '@libredb/studio/types';
import type { WorkspaceFeatures } from '@libredb/studio/workspace';

export const SQLITE_OBJECT_KINDS = [
  { id: 'table', role: 'relation', label: 'Table', labelPlural: 'Tables', hasColumns: true },
  { id: 'view', role: 'relation', label: 'View', labelPlural: 'Views', hasColumns: true },
] as const satisfies ProviderCapabilities['objectKinds'];

export const SQLITE_WORKSPACE_CAPABILITIES: ProviderCapabilities = {
  queryLanguage: 'sql',
  identifierQuoting: 'double-always',
  // Table previews become subqueries, so generated SQL must omit its statement terminator.
  statementTerminator: 'none',
  supportsExplain: false,
  supportsExternalQueryLimiting: true,
  supportsResultPagination: true,
  supportsCreateTable: false,
  supportsInlineRowEdit: false,
  supportsTransactions: false,
  supportsQueryCancel: false,
  supportsMaintenance: false,
  maintenanceOperations: [],
  supportsConnectionString: true,
  defaultPort: null,
  declaresForeignKeys: true,
  containerLevels: [],
  objectKinds: SQLITE_OBJECT_KINDS,
  schemaRefreshPattern: '',
};

export const SQLITE_WORKSPACE_FEATURES: WorkspaceFeatures = {
  charts: true,
  schemaDiagram: true,
  codeGenerator: false,
  testDataGenerator: false,
  dataImport: false,
  transactions: false,
  connectionManagement: false,
  dataMasking: false,
};
