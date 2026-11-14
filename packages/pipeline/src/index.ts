/** Public surface of @aiv/pipeline. */
export { runConnectorSync, type SyncOutcome } from './sync';
export { runTenantAnalysis, saveAnalysisRun, getTenantAssumptions } from './analyse';
export { seedDemo, DEMO_TENANT_SLUG } from './seed';
export { createTenant, addAppUser, checkConnectors, type CreateTenantInput } from './tenants';
export { audit, listAuditEvents, type AuditInput } from './audit';
export {
  getTenantPolicy,
  getScanSettings,
  saveScanSettings,
  saveTenantPolicy,
  resetTenantPolicy,
  draftPolicyFromDocument,
  reviewPolicyDraft,
  type TenantPolicy,
} from './policy';
export {
  setVendorAccessEnabled,
  grantVendorAccess,
  revokeVendorAccess,
  activeVendorGrant,
  listVendorGrants,
  MAX_VENDOR_GRANT_HOURS,
  type GrantInput,
} from './vendor';
export {
  buildTelemetryPayload,
  maybeSendTelemetry,
  telemetryEnabled,
  bucket,
  type TelemetryPayload,
} from './telemetry';
