// Explicit, reversible convenience switches for this fictitious-data installation.
export const demoFullAccess = (actor: any) =>
  process.env.APP_ENV === 'demonstracao' &&
  process.env.DEMO_TI_FULL_ACCESS === 'true' && actor?.role_id === 'ti';
export const demoMfaDisabled = () =>
  process.env.APP_ENV === 'demonstracao' && process.env.DEMO_DISABLE_TI_MFA === 'true';
