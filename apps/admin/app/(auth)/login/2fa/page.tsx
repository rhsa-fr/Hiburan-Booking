'use client';

import { useMutation } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, BrandMark, Button, Card, Input, Skeleton } from '@/components/ui';
import { isPanelRole, verifyBackupCode, verifyTwoFactor, type SessionResult } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import {
  clearMfaTicket,
  readMfaTicket,
  roleLabel,
  saveSession,
  saveToken,
  type MfaTicket
} from '@/lib/session';

type CodeMode = 'totp' | 'backup';

const TOTP_PATTERN = /^\d{6}$/;
const BACKUP_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** Kode cadangan dinormalkan ke `XXXX-XXXX` saat diketik. */
function formatBackupCode(raw: string): string {
  const compact = raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  return compact.length > 4 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

/**
 * API memakai 401 untuk dua keadaan berbeda: kode salah dan tiket yang sudah
 * mati. Pesannya yang membedakan (challenge mati selalu menyebut token).
 */
function describeTwoFactorError(error: unknown): { message: string; expired: boolean } {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return { message: 'Terlalu banyak percobaan. Coba lagi nanti.', expired: false };
    }
    if (error.status === 401) {
      const expired = /tidak valid|kedaluwarsa/i.test(error.message);
      return {
        message: expired ? 'Sesi 2FA kedaluwarsa. Masuk lagi.' : 'Kode 2FA salah.',
        expired
      };
    }
  }
  return {
    message:
      error instanceof Error && error.message
        ? error.message
        : 'Verifikasi 2FA gagal. Coba lagi.',
    expired: false
  };
}

export default function TwoFactorPage() {
  const router = useRouter();
  const [ticket, setTicket] = useState<MfaTicket | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<CodeMode>('totp');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const stored = readMfaTicket();
    if (!stored || stored.kind !== 'verify') {
      router.replace('/login');
      return;
    }
    setTicket(stored);
    setReady(true);
  }, [router]);

  const codeValid = mode === 'totp' ? TOTP_PATTERN.test(code) : BACKUP_PATTERN.test(code);

  function finish(result: SessionResult): void {
    if (!isPanelRole(result.user.roles)) {
      clearMfaTicket();
      setFormError('Akun ini tidak punya akses ke panel operasi.');
      return;
    }
    saveToken(result.access_token, result.user.id);
    const primaryRole =
      result.user.roles.find((role) => role.startsWith('admin_')) ?? result.user.roles[0] ?? '';
    saveSession({
      operator_name: result.user.email ?? result.user.phone ?? 'Operator',
      role: roleLabel(primaryRole),
      logged_in_at: new Date().toISOString(),
      user_id: result.user.id
    });
    clearMfaTicket();
    router.replace('/');
  }

  const verify = useMutation({
    mutationFn: (): Promise<SessionResult> => {
      if (!ticket) return Promise.reject(new Error('Sesi 2FA kedaluwarsa. Masuk lagi.'));
      return mode === 'backup'
        ? verifyBackupCode(ticket.token, code)
        : verifyTwoFactor(ticket.token, code);
    },
    onSuccess: finish,
    onError: (error: Error) => {
      const outcome = describeTwoFactorError(error);
      setFormError(outcome.message);
      if (!outcome.expired) return;
      clearMfaTicket();
      setTicket(null);
    }
  });

  function switchMode(): void {
    setMode((current) => (current === 'totp' ? 'backup' : 'totp'));
    setCode('');
    setCodeTouched(false);
    setFormError(null);
  }

  function cancel(): void {
    clearMfaTicket();
    router.replace('/login');
  }

  return (
    <main className="grid min-h-screen place-items-center bg-page px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark />
          <div>
            <p className="text-[15px] font-bold text-textMain">Tarlink</p>
            <p className="text-[12.5px] text-textSecondary">Panel operasi</p>
          </div>
        </div>

        {!ready ? (
          <Card className="p-6">
            <div role="status" aria-label="Menyiapkan verifikasi 2FA" className="space-y-3">
              <span className="sr-only">Menyiapkan verifikasi 2FA…</span>
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </Card>
        ) : !ticket ? (
          <Card className="p-6">
            <h1 className="text-[20px] font-bold text-textMain">Verifikasi 2FA</h1>
            <Alert tone="danger" className="mt-4">
              {formError ?? 'Sesi 2FA kedaluwarsa. Masuk lagi.'}
            </Alert>
            <Button href="/login" className="mt-5 w-full" size="md">
              Kembali ke halaman masuk
            </Button>
          </Card>
        ) : (
          <Card className="p-6">
            <h1 className="text-[20px] font-bold text-textMain">Verifikasi 2FA</h1>
            <p className="mt-1 text-[13px] leading-snug text-textSecondary">
              {mode === 'totp'
                ? 'Masukkan 6 digit kode dari aplikasi autentikator Anda.'
                : 'Masukkan salah satu kode cadangan yang Anda simpan saat pendaftaran.'}
            </p>

            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                setCodeTouched(true);
                setFormError(null);
                if (!codeValid) return;
                verify.mutate();
              }}
            >
              {mode === 'totp' ? (
                <Input
                  id="two-factor-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  label="Kode 6 digit"
                  placeholder="123456"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  onBlur={() => setCodeTouched(true)}
                  error={
                    codeTouched && !codeValid ? 'Masukkan 6 digit angka dari autentikator.' : null
                  }
                  hint="Kode berubah setiap 30 detik."
                />
              ) : (
                <Input
                  id="two-factor-backup-code"
                  type="text"
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  autoFocus
                  label="Kode cadangan"
                  placeholder="XXXX-XXXX"
                  maxLength={9}
                  value={code}
                  onChange={(event) => setCode(formatBackupCode(event.target.value))}
                  onBlur={() => setCodeTouched(true)}
                  error={
                    codeTouched && !codeValid
                      ? 'Masukkan kode cadangan 8 karakter (format XXXX-XXXX).'
                      : null
                  }
                  hint="Satu kode cadangan hanya bisa dipakai sekali."
                />
              )}

              {formError ? <Alert tone="danger">{formError}</Alert> : null}

              <Button type="submit" disabled={verify.isPending} className="w-full" size="md">
                {verify.isPending ? 'Memeriksa…' : 'Verifikasi'}
                {!verify.isPending ? (
                  <ArrowRight aria-hidden className="ml-2 h-4 w-4" />
                ) : null}
              </Button>
            </form>

            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              onClick={switchMode}
              disabled={verify.isPending}
            >
              {mode === 'totp' ? 'Pakai kode cadangan' : 'Pakai kode autentikator'}
            </Button>
          </Card>
        )}

        {ticket ? (
          <div className="mt-4 flex justify-center">
            <Button variant="ghost" size="sm" onClick={cancel} disabled={verify.isPending}>
              Batal, kembali ke halaman masuk
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
