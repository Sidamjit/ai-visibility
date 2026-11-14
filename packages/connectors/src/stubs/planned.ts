/**
 * Helper for declaring a PLANNED connector: it appears in the catalogue (so
 * sales demos and the roadmap are honest about coverage) but `sync()` throws
 * ConnectorNotImplementedError until someone implements it.
 */
import { z } from 'zod';
import { ConnectorNotImplementedError, type Connector, type PermissionRequirement } from '../types';

export function plannedConnector(def: {
  id: string;
  displayName: string;
  vendor: string;
  description: string;
  requiredPermissions: PermissionRequirement[];
  secretEnvVars: string[];
}): Connector<Record<string, unknown>> {
  return {
    ...def,
    maturity: 'planned',
    configSchema: z.record(z.string(), z.unknown()),
    async authenticate() {
      return {
        ok: false,
        message: `${def.displayName} connector is planned and not yet available.`,
      };
    },
    async sync() {
      throw new ConnectorNotImplementedError(def.id);
    },
  };
}
