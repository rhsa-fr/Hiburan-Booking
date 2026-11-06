'use client';

import { useMutation } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BrandMark, Button, Card, Input, Skeleton } from '@/components/ui';
import {
  completeTwoFactorEnrollment,
  isPanelRole,
  startTwoFactorEnrollment,
  type SessionResult,
  type TwoFactorEnrolledSession,
  type TwoFactorEnrollment
} from '@/lib/api';
import { ApiError } from '@/lib/errors';
import {
  clearMfaTicket,
  readMfaTicket,
  roleLabel,
  saveSession,
  saveToken,
  type MfaTicket
} from '@/lib/session';

type Phase = 'boot' | 'loading' | 'ready' | 'codes' | 'blocked';

const TOTP_PATTERN = /^\d{6}$/;

/** Base32 dibaca manusia dalam kelompok 4 karakter. */
function groupSecret(secret: string): string {
  return secret
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

function describeStartError(error: unknown): {
  message: string;
  blocked: boolean;
  retryable: boolean;
} {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return { message: 'Sesi 2FA kedaluwarsa. Masuk lagi.', blocked: true, retryable: false };
    }
    if (error.status === 409) {
      return {
        message:
          '2FA sudah aktif di akun ini. Masuk lagi dan masukkan kode dari aplikasi autentikator.',
        blocked: true,
        retryable: false
      };
    }
    if (error.status === 500) {
      return {
        message:
          'Server tidak bisa menyiapkan 2FA. Kunci enkripsi TOTP kemungkinan belum diisi; hubungi admin super.',
        blocked: false,
        retryable: true
      };
    }
    if (error.status === 429) {
      return {
        message: 'Terlalu banyak percobaan. Coba lagi nanti.',
        blocked: false,
        retryable: true
      };
    }
  }
  return {
    message:
      error instanceof Error && error.message
        ? error.message
        : 'Pendaftaran 2FA gagal dimuat. Coba lagi.',
    blocked: false,
    retryable: true
  };
}

function describeVerifyError(error: unknown): { message: string; blocked: boolean } {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      if (/kode 2fa salah/i.test(error.message)) {
        return { message: 'Kode 2FA salah.', blocked: false };
      }
      return { message: 'Sesi pendaftaran 2FA kedaluwarsa. Masuk lagi.', blocked: true };
    }
    if (error.status === 429) {
      return { message: 'Terlalu banyak percobaan. Coba lagi nanti.', blocked: true };
    }
    if (error.status === 409) {
      return {
        message:
          '2FA sudah aktif di akun ini. Masuk lagi dan masukkan kode dari aplikasi autentikator.',
        blocked: true
      };
    }
    if (error.status === 500) {
      return {
        message:
          'Server gagal menyelesaikan pendaftaran 2FA. Kunci enkripsi TOTP kemungkinan belum diisi; hubungi admin super.',
        blocked: false
      };
    }
  }
  return {
    message:
      error instanceof Error && error.message ? error.message : 'Pendaftaran 2FA gagal. Coba lagi.',
    blocked: false
  };
}

export default function EnrollTwoFactorPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('boot');
  const [ticket, setTicket] = useState<MfaTicket | null>(null);
  const [enrollment, setEnrollment] = useState<TwoFactorEnrollment | null>(null);
  const [enrolled, setEnrolled] = useState<TwoFactorEnrolledSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  // React 19 menjalankan effect dua kali di mode strict; enrollment hanya boleh
  // dimulai sekali karena secret-nya ditampilkan persis satu kali.
  const startedRef = useRef(false);

  const loadEnrollment = useCallback(async (token: string) => {
    setPhase('loading');
    setError(null);
    setCanRetry(false);
    try {
      const result = await startTwoFactorEnrollment(token);
      setEnrollment(result);
      setPhase('ready');
    } catch (caught) {
      const outcome = describeStartError(caught);
      setError(outcome.message);
      setCanRetry(outcome.retryable);
      if (outcome.blocked) {
        clearMfaTicket();
        setTicket(null);
      }
      setPhase('blocked');
    }
  }, []);

  useEffect(() => {
    const stored = readMfaTicket();
    if (!stored || stored.kind !== 'enroll') {
      router.replace('/login');
      return;
    }
    setTicket(stored);
    if (startedRef.current) return;
    startedRef.current = true;
    void loadEnrollment(stored.token);
  }, [router, loadEnrollment]);

  function persistSession(result: SessionResult): void {
    if (!isPanelRole(result.user.roles)) {
      clearMfaTicket();
      setError('Akun ini tidak punya akses ke panel operasi.');
      setCanRetry(false);
      setPhase('blocked');
      return;
    }
    saveToken(result.access_token);
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
    mutationFn: (): Promise<TwoFactorEnrolledSession> => {
      if (!ticket) {
        return Promise.reject(new Error('Sesi pendaftaran 2FA kedaluwarsa. Masuk lagi.'));
      }
      return completeTwoFactorEnrollment(ticket.token, code);
    },
    onSuccess: (result) => {
      // Tiket enrollment sudah dikonsumsi server; kode cadangan hidup di state.
      clearMfaTicket();
      setEnrolled(result);
      setError(null);
      setPhase('codes');
    },
    onError: (caught: Error) => {
      const outcome = describeVerifyError(caught);
      setError(outcome.message);
      if (!outcome.blocked) return;
      clearMfaTicket();
      setTicket(null);
      setEnrollment(null);
      setCanRetry(false);
      setPhase('blocked');
    }
  });

  const codeValid = TOTP_PATTERN.test(code);
  const pending = verify.isPending;

  function retry(): void {
    if (!ticket) return;
    void loadEnrollment(ticket.token);
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

        {phase === 'boot' || phase === 'loading' ? (
          <Card className="p-6">
            <div role="status" aria-label="Menyiapkan pendaftaran 2FA" className="space-y-3">
              <span className="sr-only">Menyiapkan pendaftaran 2FA…</span>
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </Card>
        ) : phase === 'blocked' ? (
          <Card className="p-6">
            <h1 className="text-[20px] font-bold text-textMain">Pendaftaran 2FA</h1>
            <Alert tone="danger" className="mt-4">
              {error ?? 'Pendaftaran 2FA tidak bisa dilanjutkan. Masuk lagi.'}
            </Alert>
            <div className="mt-5 flex flex-col gap-2">
              {canRetry ? (
                <Button onClick={retry} disabled={!ticket} className="w-full" size="md">
                  Coba lagi
                </Button>
              ) : null}
              <Button
                href="/login"
                variant={canRetry ? 'outline' : 'primary'}
                className="w-full"
                size="md"
              >
                Kembali ke halaman masuk
              </Button>
            </div>
          </Card>
        ) : phase === 'codes' && enrolled ? (
          <Card className="p-6">
            <h1 className="text-[20px] font-bold text-textMain">Simpan kode cadangan</h1>
            <p className="mt-1 text-[13px] leading-snug text-textSecondary">
              Pendaftaran 2FA selesai. Ini 10 kode cadangan Anda — simpan sebelum melanjutkan.
            </p>

            <Alert tone="warning" className="mt-4" title="Simpan offline, hanya ditampilkan sekali">
              Setiap kode hanya bisa dipakai sekali. Simpan di tempat aman di luar perangkat ini.
              Tanpa autentikator dan kode cadangan, admin super harus mereset 2FA akun ini.
            </Alert>

            <ul className="mt-4 grid grid-cols-2 gap-2">
              {enrolled.backup_codes.map((backupCode) => (
                <li
                  key={backupCode}
                  className="select-all rounded-field border border-border bg-subtle px-3 py-2 text-center font-mono text-[13px] tracking-[0.04em] text-textMain"
                >
                  {backupCode}
                </li>
              ))}
            </ul>

            <Button
              onClick={() => persistSession(enrolled)}
              className="mt-5 w-full"
              size="md"
              iconAfter={<ArrowRight aria-hidden className="h-4 w-4" />}
            >
              Saya sudah menyimpan
            </Button>
            <p className="mt-2 text-center text-[12.5px] leading-snug text-textSecondary">
              Jangan tutup halaman ini sebelum kode tersimpan.
            </p>
          </Card>
        ) : enrollment ? (
          <Card className="p-6">
            <h1 className="text-[20px] font-bold text-textMain">Daftarkan autentikator</h1>
            <p className="mt-1 text-[13px] leading-snug text-textSecondary">
              Akun admin wajib memakai 2FA. Tambahkan kunci berikut ke aplikasi autentikator Anda.
            </p>

            <div className="mt-4">
              <p className="mb-1.5 text-sm font-semibold text-textMain">Kunci manual (base32)</p>
              <code className="block select-all break-all rounded-field border border-border bg-subtle px-3.5 py-3 font-mono text-[15px] leading-relaxed tracking-[0.06em] text-textMain">
                {groupSecret(enrollment.secret)}
              </code>
            </div>

            <div className="mt-3">
              <p className="mb-1.5 text-sm font-semibold text-textMain">URI otpauth</p>
              <code className="block select-all break-all rounded-field border border-border bg-subtle px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-textSecondary">
                {enrollment.otpauth_uri}
              </code>
            </div>

            <Alert tone="info" className="mt-4">
              Tidak perlu memindai QR. Buka aplikasi autentikator, pilih “masukkan kunci secara
              manual”, lalu tempel kunci di atas.
            </Alert>

            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                setCodeTouched(true);
                setError(null);
                if (!codeValid) return;
                verify.mutate();
              }}
            >
              <Input
                id="enroll-totp-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                label="Kode 6 digit"
                placeholder="123456"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                onBlur={() => setCodeTouched(true)}
                error={
                  codeTouched && !codeValid ? 'Masukkan 6 digit kode dari autentikator.' : null
                }
                hint="Masukkan kode yang muncul setelah kunci ditambahkan."
              />

              {error ? <Alert tone="danger">{error}</Alert> : null}

              <Button type="submit" disabled={pending} className="w-full" size="md">
                {pending ? 'Mengaktifkan…' : 'Aktifkan 2FA'}
                {!pending ? <ArrowRight aria-hidden className="ml-2 h-4 w-4" /> : null}
              </Button>
            </form>
          </Card>
        ) : (
          <Card className="p-6">
            <h1 className="text-[20px] font-bold text-textMain">Pendaftaran 2FA</h1>
            <Alert tone="danger" className="mt-4">
              {error ?? 'Pendaftaran 2FA tidak bisa dilanjutkan. Masuk lagi.'}
            </Alert>
            <Button href="/login" className="mt-5 w-full" size="md">
              Kembali ke halaman masuk
            </Button>
          </Card>
        )}

        {phase === 'ready' ? (
          <div className="mt-4 flex justify-center">
            <Button variant="ghost" size="sm" onClick={cancel} disabled={pending}>
              Batal, kembali ke halaman masuk
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
