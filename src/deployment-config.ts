export type DeploymentConfigEnv = {
  ADMIN_EMAILS?: string;
  AI_GATEWAY_ID?: string;
  CF_ACCESS_ISS?: string;
  ENVIRONMENT?: string;
};

export const defaultAiGatewayId = 'default';

export function aiGatewayId(env: DeploymentConfigEnv): string {
  const configured = env.AI_GATEWAY_ID?.trim();
  return configured || defaultAiGatewayId;
}

export function workersAIGatewayId(env: DeploymentConfigEnv): string | undefined {
  return env.AI_GATEWAY_ID?.trim() || undefined;
}

export function adminEmails(env: DeploymentConfigEnv): ReadonlySet<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.includes('@')),
  );
}

export function isAdmin(env: DeploymentConfigEnv, email: string): boolean {
  return adminEmails(env).has(email.trim().toLowerCase());
}

export function canReadDiagnostics(env: DeploymentConfigEnv, email: string): boolean {
  return env.ENVIRONMENT === 'dev' || isAdmin(env, email);
}

export type AccessOAuthMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
};

export function accessIssuer(env: DeploymentConfigEnv): string | null {
  const configured = env.CF_ACCESS_ISS?.trim().replace(/\/+$/, '');
  if (!configured) return null;
  try {
    return new URL(configured).protocol === 'https:' ? configured : null;
  } catch {
    return null;
  }
}

export function accessOAuthMetadata(issuer: string): AccessOAuthMetadata {
  return {
    issuer,
    authorization_endpoint: `${issuer}/cdn-cgi/access/oauth/authorization`,
    token_endpoint: `${issuer}/cdn-cgi/access/oauth/token`,
    registration_endpoint: `${issuer}/cdn-cgi/access/oauth/registration`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };
}
