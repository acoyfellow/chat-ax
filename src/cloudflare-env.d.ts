declare namespace Cloudflare {
  interface Env {
    AI: Ai;
    MCP_CONNECTOR_ID?: string;
    MCP_CONNECTOR_NAME?: string;
    MCP_SERVER_URL?: string;
    MCP_OAUTH_RESOURCE?: string;
    MCP_OAUTH_AUTHORIZE_URL?: string;
    MCP_OAUTH_TOKEN_URL?: string;
    MCP_OAUTH_REGISTRATION_URL?: string;
    CONNECTOR_VAULT: DurableObjectNamespace<import('./connector-vault').ConnectorVaultDO>;
  }
}
