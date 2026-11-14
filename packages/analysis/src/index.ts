/** Public surface of @aiv/analysis. */
export * from './types';
export { runAnalysis, type RunAnalysisOptions } from './engine';
export { RULES, TRAINING_BY_FEATURE } from './rules';
export { buildIndex, type AnalysisIndex, type UsageIntensity } from './context';
export { siteReadiness, computeScores } from './scoring';
export { computeOrgMetrics, computeDepartmentStats, hoursPerMonthFor } from './metrics';
export {
  buildContentIndex,
  toFileViews,
  type ClassifiedFile,
  type ClassifiedFileView,
  type ContentIndex,
  type ContentLevelStat,
  type ContentMetrics,
} from './content';
