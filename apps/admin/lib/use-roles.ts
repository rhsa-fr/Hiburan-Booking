'use client';

import { useEffect, useState } from 'react';
import { readSession, readToken } from './session';

/**
 * Peran dibaca dari klaim `roles` di access token (sumber kebenaran), dengan
 * fallback ke label sesi lama. Dipakai untuk menyembunyikan tombol yang pasti
 * ditolak API — bukan untuk menggantikan otorisasi di server.
 */
const LABEL_TO_CODE: Record<string, string> = {
  'Admin super': 'admin_super',
  'Admin finance': 'admin_finance',
  'Admin support': 'admin_support'
};

function decodeRoleCodes(token: string | null): string[] {
  if (!token) return [];
  const payload = token.split('.')[1];
  if (!payload) return [];
  try {
    const normalised = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, '=');
    const parsed: unknown = JSON.parse(atob(padded));
    if (typeof parsed !== 'object' || parsed === null) return [];
    const roles = (parsed as { roles?: unknown }).roles;
    if (!Array.isArray(roles)) return [];
    return roles.filter((role): role is string => typeof role === 'string');
  } catch {
    return [];
  }
}

export function hasAnyRole(roles: string[], allowed: string[]): boolean {
  return roles.some((role) => allowed.includes(role));
}

export const VENDOR_READ_ROLES = ['admin_support', 'admin_finance', 'admin_super'];
export const VENDOR_WRITE_ROLES = ['admin_finance', 'admin_super'];
export const VENDOR_VERIFY_ROLES = ['admin_super'];

export function useRoles(): { roles: string[]; ready: boolean } {
  const [state, setState] = useState<{ roles: string[]; ready: boolean }>({
    roles: [],
    ready: false
  });

  useEffect(() => {
    const fromToken = decodeRoleCodes(readToken());
    if (fromToken.length > 0) {
      setState({ roles: fromToken, ready: true });
      return;
    }
    const label = readSession()?.role ?? '';
    const mapped = LABEL_TO_CODE[label];
    setState({ roles: mapped ? [mapped] : [], ready: true });
  }, []);

  return state;
}
