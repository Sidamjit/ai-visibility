/** Public surface of @aiv/pipeline. */
export { runConnectorSync, type SyncOutcome } from './sync';
export { runTenantAnalysis, saveAnalysisRun, getTenantAssumptions } from './analyse';
export { seedDemo, DEMO_TENANT_SLUG } from './seed';
