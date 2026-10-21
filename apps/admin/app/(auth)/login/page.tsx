'use client';

import { useMutation } from '@tanstack/react-query';
import { ArrowRight, LockKeyhole, Mail } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Alert, BrandMark, Button, Card, Input } from '@/components/ui';
import {
  googleClientId,
  googleLoginEnabled,
  isPanelRole,
  loginWithGoogle,
  loginWithPassword,
  type AuthResult
} from '@/lib/api';
import { roleLabel, saveSession, saveToken } from '@/lib/session';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: { theme?: string; size?: string; width?: number; text?: string }
          ) => void;
        };
      };
    };
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);

  const emailValid = EMAIL_PATTERN.test(email.trim());
  const passwordValid = password.length >= 8;

  function finish(result: AuthResult): void {
    if (!isPanelRole(result.user.roles)) {
      setFormError('Akun ini tidak punya akses ke panel operasi.');
      return;
    }
    saveToken(result.access_token);
    const primaryRole =
      result.user.roles.find((role) => role.startsWith('admin_')) ?? result.user.roles[0] ?? '';
    saveSession({
      operator_name: result.user.email ?? result.user.phone ?? 'Operator',
      role: roleLabel(primaryRole),
      logged_in_at: new Date().toISOString()
    });
    router.replace('/');
  }

  const login = useMutation({
    mutationFn: () => loginWithPassword(email.trim(), password),
    onSuccess: finish,
    onError: (error: Error) => {
      setFormError(error.message || 'Gagal masuk. Coba lagi.');
    }
  });

  const googleLogin = useMutation({
    mutationFn: (idToken: string) => loginWithGoogle(idToken),
    onSuccess: finish,
    onError: (error: Error) => {
      setFormError(error.message || 'Google Sign-In gagal.');
    }
  });

  useEffect(() => {
    if (!googleLoginEnabled()) return;
    const clientId = googleClientId();
    let cancelled = false;

    function mount(): void {
      if (cancelled || !window.google || !googleButtonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (response.credential) {
            setFormError(null);
            googleLogin.mutate(response.credential);
          }
        }
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: 'outline',
        size: 'large',
        width: 360,
        text: 'signin_with'
      });
    }

    if (window.google) {
      mount();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = mount;
    document.head.appendChild(script);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = login.isPending || googleLogin.isPending;

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

        <Card className="p-6">
          <h1 className="text-[20px] font-bold text-textMain">Masuk</h1>
          <p className="mt-1 text-[13px] leading-snug text-textSecondary">
            Gunakan email dan kata sandi akun operator Anda.
          </p>

          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              setEmailTouched(true);
              setPasswordTouched(true);
              setFormError(null);
              if (!emailValid || !passwordValid) return;
              login.mutate();
            }}
          >
            <Input
              id="login-email"
              type="email"
              label="Email"
              autoComplete="username"
              placeholder="nama@tarlink.id"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onBlur={() => setEmailTouched(true)}
              error={emailTouched && !emailValid ? 'Masukkan email yang valid.' : null}
            />

            <div>
              <Input
                id="login-password"
                type="password"
                label="Kata sandi"
                autoComplete="current-password"
                placeholder="Minimal 8 karakter"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onBlur={() => setPasswordTouched(true)}
                error={
                  passwordTouched && !passwordValid ? 'Kata sandi minimal 8 karakter.' : null
                }
              />
              <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-textSecondary">
                <LockKeyhole aria-hidden className="h-3.5 w-3.5" />
                Percobaan dibatasi 5 kali per 10 menit.
              </p>
            </div>

            {formError ? <Alert tone="danger">{formError}</Alert> : null}

            <Button type="submit" disabled={busy} className="w-full" size="md">
              {login.isPending ? 'Memeriksa…' : 'Masuk'}
              {!login.isPending ? <ArrowRight aria-hidden className="ml-2 h-4 w-4" /> : null}
            </Button>
          </form>

          {googleLoginEnabled() ? (
            <>
              <div className="my-5 flex items-center gap-3 text-[12px] text-textMuted">
                <span className="h-px flex-1 bg-border" />
                atau
                <span className="h-px flex-1 bg-border" />
              </div>
              <div ref={googleButtonRef} className="flex justify-center" />
              {googleLogin.isPending ? (
                <p className="mt-2 text-center text-[12.5px] text-textSecondary">
                  Menghubungkan ke Google…
                </p>
              ) : null}
            </>
          ) : null}
        </Card>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-[12.5px] text-textSecondary">
          <Mail aria-hidden className="h-3.5 w-3.5" />
          Tidak punya akses? Hubungi admin super.
        </p>
      </div>
    </main>
  );
}
