import { browserSupportsWebAuthn, startAuthentication, startRegistration, type AuthenticationResponseJSON, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON, type RegistrationResponseJSON } from '@simplewebauthn/browser';
import { api } from '../api/client';
import type { LoginResult, PasskeyInfo } from '../api/types';

export const passkeysSupported = () => typeof window !== 'undefined' && browserSupportsWebAuthn();

/** Bricht der Benutzer den Browser-Dialog ab, wirft der Browser NotAllowedError – das ist kein Fehler zum Anzeigen. */
export const isUserCancel = (e: unknown) => e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError');

/** Passkey registrieren: Passwort bestätigen → Browser-Dialog → auf dem Server speichern. */
export async function registerPasskey(password: string, name: string): Promise<PasskeyInfo[]> {
  const { options, challengeId } = await api.post<{ options: PublicKeyCredentialCreationOptionsJSON; challengeId: string }>('/api/auth/passkeys/register/options', { password });
  const response: RegistrationResponseJSON = await startRegistration({ optionsJSON: options });
  const r = await api.post<{ passkeys: PasskeyInfo[] }>('/api/auth/passkeys/register/verify', { challengeId, response, name });
  return r.passkeys;
}

/** Anmeldung mit Passkey – ohne Ticket beliebiges Konto (Discoverable Credential), mit MFA-Ticket als zweiter Schritt. */
export async function signInWithPasskey(ticket?: string): Promise<LoginResult> {
  const { options, challengeId } = await api.post<{ options: PublicKeyCredentialRequestOptionsJSON; challengeId: string }>('/api/auth/passkey/options', ticket ? { ticket } : {});
  const response: AuthenticationResponseJSON = await startAuthentication({ optionsJSON: options });
  return api.post<LoginResult>('/api/auth/passkey/verify', { challengeId, response, ticket });
}
