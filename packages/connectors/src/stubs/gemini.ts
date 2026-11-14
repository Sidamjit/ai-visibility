/**
 * Google Gemini for Workspace connector (PLANNED).
 *
 * TODO(implementation):
 *  - Auth: Google Cloud service account with domain-wide delegation, impersonating
 *    a read-only admin. Scopes: admin.reports.audit.readonly, admin.directory.user.readonly,
 *    apps.licensing (read). Secret: GOOGLE_SERVICE_ACCOUNT_JSON.
 *  - Licences: Licensing API (Gemini SKUs) -> Licence.
 *  - Usage: Admin SDK Reports API 'gemini_in_workspace_apps' activity -> UsageSummary.
 *  - Drive exposure (same oversharing rules as SharePoint): Drive API files.list with
 *    permissions (anyoneWithLink, domain) -> ContentLocation + SharingGrant.
 */
import { plannedConnector } from './planned';

export const geminiConnector = plannedConnector({
  id: 'google-gemini',
  displayName: 'Google Gemini for Workspace',
  vendor: 'Google',
  description: 'Gemini licences and usage plus Google Drive sharing exposure via Admin SDK.',
  requiredPermissions: [
    {
      name: 'admin.reports.audit.readonly',
      type: 'Application',
      reason: 'Gemini activity events.',
      dataAccessed: 'Activity metadata.',
      required: true,
    },
    {
      name: 'admin.directory.user.readonly',
      type: 'Application',
      reason: 'Users and org units.',
      dataAccessed: 'User profiles.',
      required: true,
    },
    {
      name: 'drive.metadata.readonly',
      type: 'Application',
      reason: 'Sharing exposure of Drive files.',
      dataAccessed: 'File names and permissions (no content).',
      required: false,
    },
  ],
  secretEnvVars: ['GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_ADMIN_IMPERSONATE'],
});
