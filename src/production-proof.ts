export function verifiedActorId(identity: { sub: string }): string {
  return identity.sub;
}

export function isProductionProofActor(
  configuredActor: string | undefined,
  identityEmail: string,
): boolean {
  return Boolean(configuredActor) && identityEmail === configuredActor;
}
