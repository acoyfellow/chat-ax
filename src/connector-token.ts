import * as v from 'valibot';
import { type ConnectorVaultDO, connectorVault } from './connector-vault';

export async function connectorAccessToken(
  namespace: DurableObjectNamespace<ConnectorVaultDO>,
  actorId: string,
): Promise<string> {
  const response = await connectorVault(namespace, actorId).fetch('https://vault/token');
  const result = v.parse(v.object({ token: v.nullable(v.string()) }), await response.json());
  if (!result.token) throw new Error('Connect your MCP connector in Settings to use its tools');
  return result.token;
}
