'use client';

import { Fragment, useState } from 'react';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  KeyValue,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableFoot,
  TableHead,
  TableHeadCell,
  TableRow,
  Tabs
} from '@/components/ui';
import { formatDateTimeID, formatIDR } from '@/lib/format';
import { accountTypeLabel, computeAccountBalances, journalTotals } from '@/lib/ledger';
import type { LedgerData } from '@/lib/types';

const SOURCE_LABELS: Record<string, string> = {
  payment: 'Pembayaran',
  settlement: 'Pelunasan',
  release: 'Release dana',
  payout: 'Payout vendor',
  clawback: 'Clawback sengketa'
};

export function JournalLedger({ data }: { data: LedgerData }) {
  const [tab, setTab] = useState('entries');
  const [expanded, setExpanded] = useState<string[]>([]);

  const balances = computeAccountBalances(data.accounts, data.entries);
  const totalDebit = data.entries.reduce(
    (sum, entry) => sum + journalTotals(entry).debit_idr,
    0
  );
  const totalCredit = data.entries.reduce(
    (sum, entry) => sum + journalTotals(entry).credit_idr,
    0
  );
  const unbalanced = data.entries.filter((entry) => !journalTotals(entry).balanced);

  function toggle(id: string) {
    setExpanded((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Ringkasan jurnal"
            description="Seluruh angka dihitung ulang dari baris jurnal setiap kali halaman dimuat."
          />
          <KeyValue
            className="rounded-none border-x-0 border-b-0"
            items={[
              { label: 'Jumlah entri', value: String(data.entries.length) },
              { label: 'Total debit', value: formatIDR(totalDebit) },
              { label: 'Total kredit', value: formatIDR(totalCredit) },
              {
                label: 'Selisih Dr/Cr',
                value: formatIDR(totalDebit - totalCredit),
                tone: totalDebit === totalCredit ? 'ok' : 'danger'
              }
            ]}
          />
          <div className="border-t border-border px-5 py-3">
            {unbalanced.length === 0 ? (
              <p className="text-sm text-textSecondary">
                Semua entri seimbang: jumlah debit sama dengan jumlah kredit.
              </p>
            ) : (
              <p className="text-sm font-semibold text-danger">
                {unbalanced.length} entri tidak seimbang. Periksa baris debit dan kredit.
              </p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Cara saldo dihitung"
            description="Tidak ada kolom saldo yang disimpan di data."
          />
          <div className="space-y-3 px-5 py-4 text-sm leading-relaxed text-textSecondary">
            <p>
              Saldo tiap akun adalah hasil hitung ulang dari seluruh baris debit dan kredit pada
              jurnal. Tidak ada angka <span className="font-semibold text-textMain">balance_after</span>{' '}
              yang disimpan di mana pun.
            </p>
            <p>
              Akun bertipe aset, beban, dan biaya memakai saldo normal debit. Akun kewajiban,
              ekuitas, dan pendapatan memakai saldo normal kredit.
            </p>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 pt-4">
          <Tabs
            items={[
              { id: 'entries', label: 'Entri jurnal', count: data.entries.length },
              { id: 'accounts', label: 'Saldo akun', count: balances.length }
            ]}
            value={tab}
            onChange={setTab}
            ariaLabel="Pilih tampilan jurnal"
          />
        </div>

        {tab === 'entries' ? (
          data.entries.length === 0 ? (
            <EmptyState
              title="Belum ada entri jurnal"
              description="Entri muncul saat pembayaran diterima atau saat dana dicairkan dari antrean pencairan."
              action={
                <Button variant="outline" href="/release">
                  Buka antrean pencairan
                </Button>
              }
            />
          ) : (
            <Table
              label="Entri jurnal beserta baris debit dan kredit"
              maxHeight="max-h-[70vh]"
              className="min-w-[900px]"
            >
              <TableHead>
                <TableRow>
                  <TableHeadCell className="w-12">
                    <span className="sr-only">Buka baris</span>
                  </TableHeadCell>
                  <TableHeadCell>Kode</TableHeadCell>
                  <TableHeadCell>Tanggal</TableHeadCell>
                  <TableHeadCell>Deskripsi</TableHeadCell>
                  <TableHeadCell align="right">Debit</TableHeadCell>
                  <TableHeadCell align="right">Kredit</TableHeadCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.entries.map((entry) => {
                  const totals = journalTotals(entry);
                  const isOpen = expanded.includes(entry.id);
                  return (
                    <Fragment key={entry.id}>
                      <TableRow>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggle(entry.id)}
                            ariaLabel={
                              isOpen
                                ? `Tutup baris jurnal ${entry.code}`
                                : `Buka baris jurnal ${entry.code}`
                            }
                            ariaExpanded={isOpen}
                            className="px-2"
                            icon={
                              <span aria-hidden className="text-base leading-none">
                                {isOpen ? '−' : '+'}
                              </span>
                            }
                          >
                            <span className="sr-only">Baris jurnal</span>
                          </Button>
                        </TableCell>
                        <TableCell>
                          <p className="tnum text-sm font-semibold text-textMain">{entry.code}</p>
                          <p className="mt-0.5 text-sm text-textSecondary">
                            {SOURCE_LABELS[entry.source_type] ?? entry.source_type} ·{' '}
                            {entry.source_ref}
                          </p>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm text-textMain">{formatDateTimeID(entry.posted_at)}</p>
                          <p className="mt-0.5 text-sm text-textSecondary">{entry.created_by}</p>
                        </TableCell>
                        <TableCell>
                          <p className="text-base text-textMain">{entry.description}</p>
                        </TableCell>
                        <TableCell align="right">
                          <span className="tnum text-textMain">{formatIDR(totals.debit_idr)}</span>
                        </TableCell>
                        <TableCell align="right">
                          <span className="tnum font-medium text-textMain">
                            {formatIDR(totals.credit_idr)}
                          </span>
                        </TableCell>
                      </TableRow>
                      {isOpen ? (
                        <TableRow>
                          <TableCell className="bg-subtle/60 p-0">
                            <Table label={`Baris debit dan kredit ${entry.code}`} maxHeight={null}>
                              <TableHead>
                                <TableRow>
                                  <TableHeadCell>Akun</TableHeadCell>
                                  <TableHeadCell>Keterangan</TableHeadCell>
                                  <TableHeadCell align="right">Debit</TableHeadCell>
                                  <TableHeadCell align="right">Kredit</TableHeadCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {entry.lines.map((line) => (
                                  <TableRow key={line.id}>
                                    <TableCell>
                                      <p className="tnum text-sm font-medium text-textMain">
                                        {line.account_code} · {line.account_name}
                                      </p>
                                    </TableCell>
                                    <TableCell>
                                      <p className="text-sm text-textSecondary">{line.memo}</p>
                                    </TableCell>
                                    <TableCell align="right">
                                      <span
                                        className={
                                          line.side === 'debit'
                                            ? 'tnum text-sm text-primary'
                                            : 'tnum text-sm text-textSecondary'
                                        }
                                      >
                                        {line.side === 'debit' ? formatIDR(line.amount_idr) : '—'}
                                      </span>
                                    </TableCell>
                                    <TableCell align="right">
                                      <span
                                        className={
                                          line.side === 'credit'
                                            ? 'tnum text-sm font-semibold text-textMain'
                                            : 'tnum text-sm text-textSecondary'
                                        }
                                      >
                                        {line.side === 'credit' ? formatIDR(line.amount_idr) : '—'}
                                      </span>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                              <TableFoot>
                                <TableRow>
                                  <TableCell align="right" className="font-semibold text-textMain">
                                    Total
                                  </TableCell>
                                  <TableCell align="right" className="tnum font-semibold text-textMain">
                                    {formatIDR(totals.debit_idr)}
                                  </TableCell>
                                  <TableCell align="right" className="tnum font-semibold text-textMain">
                                    {formatIDR(totals.credit_idr)}
                                  </TableCell>
                                </TableRow>
                              </TableFoot>
                            </Table>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )
        ) : (
          <Table
            label="Saldo per akun yang dihitung ulang dari jurnal"
            maxHeight="max-h-[70vh]"
            className="min-w-[820px]"
          >
            <TableHead>
              <TableRow>
                <TableHeadCell>Kode</TableHeadCell>
                <TableHeadCell>Nama akun</TableHeadCell>
                <TableHeadCell>Tipe</TableHeadCell>
                <TableHeadCell align="right">Debit</TableHeadCell>
                <TableHeadCell align="right">Kredit</TableHeadCell>
                <TableHeadCell align="right">Saldo</TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {balances.map((account) => (
                <TableRow key={account.code}>
                  <TableCell>
                    <span className="tnum text-sm font-semibold text-textMain">{account.code}</span>
                  </TableCell>
                  <TableCell>
                    <p className="text-base text-textMain">{account.name}</p>
                    <p className="text-sm text-textSecondary">
                      Saldo normal {account.normal_balance === 'debit' ? 'debit' : 'kredit'}
                    </p>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={account.type === 'revenue' ? 'primary' : 'muted'}>
                      {accountTypeLabel(account.type)}
                    </StatusBadge>
                  </TableCell>
                  <TableCell align="right">
                    <span className="tnum text-textMain">{formatIDR(account.debit_idr)}</span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="tnum text-textMain">{formatIDR(account.credit_idr)}</span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="tnum font-semibold text-textMain">
                      {formatIDR(account.balance_idr)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
