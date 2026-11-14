/**
 * The exact Microsoft Graph APPLICATION permissions the pilot uses, and why.
 *
 * All are READ-ONLY. This list is the single source of truth: it is rendered on
 * the Connectors page and must match docs/PILOT_SETUP.md. If you add a Graph
 * call that needs a new permission, add it here AND to the doc.
 */
import type { PermissionRequirement } from '../types';

export const GRAPH_PERMISSIONS: readonly PermissionRequirement[] = [
  {
    name: 'Sites.Read.All',
    type: 'Application',
    reason: 'Enumerate SharePoint sites and document libraries to map where content lives.',
    dataAccessed:
      'Site/library names, URLs, last-modified dates (GET /sites/getAllSites, /sites/{id}/drives).',
    required: true,
  },
  {
    name: 'Files.Read.All',
    type: 'Application',
    reason:
      'Read file/folder METADATA and sharing permissions (anyone links, organisation-wide links, guests, unique permissions). File contents are never downloaded.',
    dataAccessed:
      'Item names, paths, modified dates, sharing links/permissions (GET /drives/{id}/root/delta, /items/{id}/permissions).',
    required: true,
  },
  {
    name: 'User.Read.All',
    type: 'Application',
    reason: 'Resolve people to departments, detect guest accounts, and read licence assignments.',
    dataAccessed:
      'Display name, UPN, department, job title, userType, accountEnabled, assignedLicenses (GET /users, /subscribedSkus).',
    required: true,
  },
  {
    name: 'Group.Read.All',
    type: 'Application',
    reason:
      'Read Microsoft 365 group/Team visibility (public vs private), membership counts and guest counts, and the sensitivity label applied to the group/site.',
    dataAccessed:
      'Group visibility, assignedLabels, member counts (GET /groups, /groups/{id}/members/$count, /groups/{id}/sites/root).',
    required: true,
  },
  {
    name: 'Reports.Read.All',
    type: 'Application',
    reason:
      'Read Microsoft 365 Copilot usage reports to measure adoption, feature breadth and inactive seats.',
    dataAccessed:
      "Per-user last-activity dates per Copilot app and active days (GET /copilot/reports/getMicrosoft365CopilotUsageUserDetail(period='D28'), getMicrosoft365CopilotUserCountSummary). Only licensed Copilot users are reported.",
    required: true,
  },
  {
    name: 'AuditLog.Read.All',
    type: 'Application',
    reason:
      'Read last sign-in dates to spot dormant accounts that still hold licences or access. Requires Entra ID P1/P2.',
    dataAccessed: 'users.signInActivity (last sign-in timestamp only).',
    required: false,
  },
  {
    name: 'InformationProtectionPolicy.Read.All',
    type: 'Application',
    reason:
      'Read the catalogue of Purview sensitivity labels so label IDs can be shown by name and ranked by sensitivity.',
    dataAccessed:
      'Label names, IDs, priority (GET /security/informationProtection/sensitivityLabels, beta).',
    required: false,
  },
];
