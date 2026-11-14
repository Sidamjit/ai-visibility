/**
 * Connector registry. To add a connector: implement `Connector` in its own
 * folder and add it to `CONNECTORS` below. Nothing else needs to change.
 */
import type { Connector } from './types';
import { demoConnector } from './demo/connector';
import { microsoftGraphConnector } from './microsoft-graph/connector';
import { chatgptEnterpriseConnector } from './stubs/chatgpt-enterprise';
import { claudeConnector } from './stubs/claude';
import { geminiConnector } from './stubs/gemini';
import { customOtelConnector } from './stubs/custom-otel';

export const CONNECTORS: ReadonlyArray<Connector<unknown>> = [
  microsoftGraphConnector,
  demoConnector,
  chatgptEnterpriseConnector,
  claudeConnector,
  geminiConnector,
  customOtelConnector,
];

export function getConnector(id: string): Connector<unknown> | undefined {
  return CONNECTORS.find((c) => c.id === id);
}
