'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  BlockSkeleton,
  Button,
  ErrorState,
  Input,
  StatusBadge
} from '@/components/ui';
import {
  getVendorPayoutBankAccounts,
  rejectVendorPayoutBankAccount,
  verifyVendorPayoutBankAccount
} from '@/lib/api';
import { formatDateID } from '@/lib/format';
import { BANK_VERIFY_ROLES, hasAnyRole, useRoles } from '@/lib/use-roles';
import type { PayoutBankAccount } from '@/lib/types';

const MIN_REASON = 5;

function toneFor(status: PayoutBankAccount['status']) {
  return status === 'verified' ? 'ok' : status === 'rejected' ? 'danger' : 'soft';
}

function labelFor(status: PayoutBankAccount['status']): string {
  return status === 'verified' ? 'Terverifikasi' : status === 'rejected' ? 'Ditolak' : 'Menunggu';
}

/**
 * Verifikasi rekening pencairan (admin_super). Nomor rekening hanya tampil
 * dalam bentuk masked; angka penuh tidak pernah dikirim ke browser.
 */
export function BankAccountVerification({ vendorId }: { vendorId: string }) {
  const queryClient = useQueryClient();
  const { roles } = useRoles();
  const canVerify = hasAnyRole(roles, BANK_VERIFY_ROLES);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const query = useQuery({
    queryKey: ['vendor-bank-accounts', vendorId],
    queryFn: () => getVendorPayoutBankAccounts(vendorId),
    enabled: canVerify
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['vendor-bank-accounts', vendorId] });
    void queryClient.invalidateQueries({ queryKey: ['vendor', vendorId] });
    void queryClient.invalidateQueries({ queryKey: ['payout-eligible'] });
  }

  const verify = useMutation({
    mutationFn: (id: string) => verifyVendorPayoutBankAccount(vendorId, id),
    onSuccess: () => invalidate()
  });

  const reject = useMutation({
    mutationFn: (id: string) => rejectVendorPayoutBankAccount(vendorId, id, reason.trim()),
    onSuccess: () => {
      setRejecting(null);
      setReason('');
      invalidate();
    }
  });

  if (!canVerify) return null;

  const items = query.data ?? [];
  if (query.isLoading) return <BlockSkeleton rows={2} />;
  if (query.isError) {
    return (
      <ErrorState
        message={
          query.error instanceof Error ? query.error.message : 'Daftar rekening gagal dimuat.'
        }
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  if (items.length === 0) return null;

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-textMain">Verifikasi rekening pencairan</h3>
        <StatusBadge tone="soft">admin_super</StatusBadge>
      </div>

      {verify.error || reject.error ? (
        <Alert tone="danger">
          {(verify.error ?? reject.error)?.message ?? 'Aksi rekening gagal.'}
        </Alert>
      ) : null}

      <ul className="divide-y divide-border overflow-hidden rounded-field border border-border">
        {items.map((account) => (
          <li key={account.id} className="space-y-2 px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-textMain">
                  {account.bank_name} · {account.account_number_masked}
                </p>
                <p className="text-xs text-textSecondary">
                  a.n. {account.account_holder_name} · cooling sampai{' '}
                  {formatDateID(account.cooling_until)}
                </p>
              </div>
              <StatusBadge tone={toneFor(account.status)}>{labelFor(account.status)}</StatusBadge>
            </div>

            {account.status !== 'verified' ? (
              rejecting === account.id ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <Input
                      id={`bank-reason-${account.id}`}
                      label="Alasan penolakan"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      hint={`Minimal ${MIN_REASON} karakter.`}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => reject.mutate(account.id)}
                    disabled={reject.isPending || reason.trim().length < MIN_REASON}
                  >
                    Kirim penolakan
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRejecting(null);
                      setReason('');
                    }}
                    disabled={reject.isPending}
                  >
                    Batal
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => verify.mutate(account.id)}
                    disabled={verify.isPending}
                    icon={<ShieldCheck aria-hidden className="h-4 w-4" />}
                  >
                    Verifikasi
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRejecting(account.id);
                      setReason('');
                    }}
                  >
                    Tolak
                  </Button>
                </div>
              )
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
