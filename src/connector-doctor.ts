export type DoctorStep = { step: string; ok: boolean; detail: string };

export type DoctorProbes = {
  configured: () => { name: string; serverUrl: string } | null;
  signIn: () => Promise<{ ok: boolean; detail: string }>;
  status: () => Promise<{ connected: boolean }>;
  token: () => Promise<string | null>;
  listTools: () => Promise<{ name: string }[]>;
};

export async function diagnoseConnector(email: string, probes: DoctorProbes): Promise<DoctorStep[]> {
  const steps: DoctorStep[] = [];
  const connector = probes.configured();
  if (!connector) {
    steps.push({ step: 'configured', ok: false, detail: 'This workspace has no connector configured.' });
    return steps;
  }
  steps.push({ step: 'configured', ok: true, detail: `${connector.name} at ${connector.serverUrl}` });
  const status = await probes.status().catch(() => ({ connected: false }));
  if (!status.connected) {
    const signIn = await probes.signIn().catch((error: unknown) => ({ ok: false, detail: error instanceof Error ? error.message : 'Sign-in check failed' }));
    steps.push({ step: 'sign-in', ok: signIn.ok, detail: signIn.detail });
    if (!signIn.ok) return steps;
  }
  steps.push({
    step: 'linked',
    ok: status.connected,
    detail: status.connected
      ? `${email} has linked ${connector.name}.`
      : `${email} has not linked ${connector.name}. Fix: Settings, then Connect ${connector.name}.`,
  });
  if (!status.connected) return steps;
  const token = await probes.token().catch(() => null);
  steps.push({
    step: 'token',
    ok: token !== null,
    detail: token ? 'A valid access token is available.' : `The saved sign-in expired and could not be refreshed. Fix: Settings, Disconnect, then Connect ${connector.name} again.`,
  });
  if (!token) return steps;
  try {
    const tools = await probes.listTools();
    steps.push({
      step: 'tools',
      ok: tools.length > 0,
      detail: tools.length ? `${tools.length} tools respond, for example ${tools.slice(0, 3).map((tool) => tool.name).join(', ')}.` : `${connector.name} answered but offered no tools.`,
    });
  } catch (error) {
    steps.push({ step: 'tools', ok: false, detail: `${connector.name} refused the request: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'}` });
  }
  return steps;
}

export function doctorReport(steps: DoctorStep[]): string {
  return steps.map((step) => `${step.ok ? 'OK  ' : 'FAIL'} ${step.step}: ${step.detail}`).join('\n');
}
