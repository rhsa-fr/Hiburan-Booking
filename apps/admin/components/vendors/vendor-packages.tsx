'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, PauseCircle, Pencil, Plus, RotateCw } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  DisabledAction,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TableSkeleton,
  Textarea
} from '@/components/ui';
import {
  createVendorPackage,
  deleteVendorPackage,
  getVendorPackages,
  updateVendorPackage
} from '@/lib/api';
import {
  addThousandsSeparatorOnInput,
  formatIDR,
  parseIntInput
} from '@/lib/format';
import type { PackageRow } from '@/lib/types';
import type { VendorNotice } from './notice';

function durationLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} menit`;
  if (rest === 0) return `${hours} jam`;
  return `${hours} jam ${rest} menit`;
}

interface Draft {
  name: string;
  duration: string;
  price: string;
}

export function VendorPackages({
  vendorId,
  canWrite,
  rolesReady,
  onNotify
}: {
  vendorId: string;
  canWrite: boolean;
  rolesReady: boolean;
  onNotify: (notice: VendorNotice) => void;
}) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: '', duration: '', price: '' });
  const [draftError, setDraftError] = useState<string | null>(null);
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<PackageRow | null>(null);

  const [newName, setNewName] = useState('');
  const [newDuration, setNewDuration] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newActive, setNewActive] = useState(true);
  const [newTouched, setNewTouched] = useState(false);

  const packagesQuery = useQuery({
    queryKey: ['vendor-packages', vendorId],
    queryFn: () => getVendorPackages(vendorId)
  });

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ['vendor-packages', vendorId] });
  }

  const create = useMutation({
    mutationFn: () =>
      createVendorPackage(vendorId, {
        name: newName.trim(),
        duration_minutes: parseIntInput(newDuration),
        base_price_idr: parseIntInput(newPrice),
        is_active: newActive,
        ...(newDescription.trim() ? { description: newDescription.trim() } : {})
      }),
    onSuccess: (row) => {
      refresh();
      setAddOpen(false);
      setNewName('');
      setNewDuration('');
      setNewPrice('');
      setNewDescription('');
      setNewActive(true);
      setNewTouched(false);
      onNotify({
        tone: 'ok',
        title: 'Paket ditambahkan',
        description: `${row.name} · ${formatIDR(row.base_price_idr)}`
      });
    }
  });

  const update = useMutation({
    mutationFn: (input: { id: string; patch: Parameters<typeof updateVendorPackage>[2] }) =>
      updateVendorPackage(vendorId, input.id, input.patch),
    onSuccess: (row, input) => {
      refresh();
      setEditingId(null);
      setEditConfirmOpen(false);
      setDraftError(null);
      onNotify({
        tone: 'ok',
        title: input.patch.is_active === true ? 'Paket diaktifkan' : 'Paket diperbarui',
        description: row.name
      });
    }
  });

  const remove = useMutation({
    mutationFn: (row: PackageRow) => deleteVendorPackage(vendorId, row.id),
    onSuccess: (_result, row) => {
      refresh();
      setRemoveTarget(null);
      onNotify({
        tone: 'ok',
        title: 'Paket dinonaktifkan',
        description: `${row.name} tidak ditawarkan lagi, tetapi booking lama tetap merujuk ke paket ini.`
      });
    }
  });

  function startEdit(row: PackageRow): void {
    update.reset();
    setDraftError(null);
    setEditConfirmOpen(false);
    setEditingId(row.id);
    setDraft({
      name: row.name,
      duration: String(row.duration_minutes),
      price: addThousandsSeparatorOnInput(String(row.base_price_idr))
    });
  }

  function saveEdit(): void {
    const name = draft.name.trim();
    const duration = parseIntInput(draft.duration);
    const price = parseIntInput(draft.price);
    if (name.length < 2) {
      setDraftError('Nama paket minimal 2 karakter.');
      return;
    }
    if (duration <= 0) {
      setDraftError('Durasi harus lebih dari 0 menit.');
      return;
    }
    if (price < 0) {
      setDraftError('Harga tidak boleh negatif.');
      return;
    }
    setDraftError(null);
    setEditConfirmOpen(true);
  }

  const editingRow = packagesQuery.data?.items.find((row) => row.id === editingId) ?? null;
  const editingPrice = parseIntInput(draft.price);
  const priceChanged = editingRow !== null && editingPrice !== editingRow.base_price_idr;

  const newNameError = newName.trim().length >= 2 ? null : 'Nama paket minimal 2 karakter.';
  const newDurationError =
    parseIntInput(newDuration) > 0 ? null : 'Durasi harus lebih dari 0 menit.';
  const newPriceError = parseIntInput(newPrice) >= 0 ? null : 'Harga tidak boleh negatif.';
  const newInvalid = Boolean(newNameError || newDurationError || newPriceError);

  const mutationError = create.isError
    ? create.error.message
    : update.isError
      ? update.error.message
      : remove.isError
        ? remove.error.message
        : null;

  function closeAdd(): void {
    if (create.isPending) return;
    setAddOpen(false);
    create.reset();
  }

  return (
    <>
      <Card labelledBy="vendor-packages-title">
        <CardHeader
          title={<span id="vendor-packages-title">Paket</span>}
          description="Harga paket dipakai sebagai dasar komisi dan DP. Nonaktifkan paket, jangan hapus riwayatnya."
          icon={<Boxes aria-hidden className="h-4 w-4" />}
          action={
            rolesReady ? (
              canWrite ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    create.reset();
                    setAddOpen(true);
                  }}
                  icon={<Plus aria-hidden className="h-4 w-4" />}
                >
                  Tambah paket
                </Button>
              ) : (
                <DisabledAction
                  label="Tambah paket"
                  reason="Hanya admin finance dan admin super yang boleh mengubah paket."
                />
              )
            ) : (
              <Skeleton className="h-12 w-36" />
            )
          }
        />

        {mutationError ? (
          <div className="px-5 pt-4">
            <Alert tone="danger" title="Perubahan paket gagal">
              {mutationError}
            </Alert>
          </div>
        ) : null}

        {packagesQuery.isPending ? (
          <TableSkeleton rows={3} />
        ) : packagesQuery.isError ? (
          <ErrorState
            title="Paket belum bisa dimuat"
            message={
              packagesQuery.error instanceof Error
                ? packagesQuery.error.message
                : 'Daftar paket tidak bisa dimuat. Coba lagi.'
            }
            onRetry={() => void packagesQuery.refetch()}
            retrying={packagesQuery.isFetching}
          />
        ) : packagesQuery.data && packagesQuery.data.items.length === 0 ? (
          <EmptyState
            icon={<Boxes aria-hidden className="h-6 w-6" />}
            title="Belum ada paket"
            description="Tambah paket pertama supaya vendor ini bisa menerima booking."
            action={
              canWrite ? (
                <Button
                  onClick={() => {
                    create.reset();
                    setAddOpen(true);
                  }}
                  icon={<Plus aria-hidden className="h-4 w-4" />}
                >
                  Tambah paket pertama
                </Button>
              ) : undefined
            }
          />
        ) : packagesQuery.data ? (
          <Table
            label="Daftar paket vendor"
            maxHeight={null}
            className="min-w-[720px]"
          >
            <TableHead>
              <TableRow>
                <TableHeadCell>Paket</TableHeadCell>
                <TableHeadCell>Durasi</TableHeadCell>
                <TableHeadCell align="right">Harga</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell align="right">
                  <span className="sr-only">Aksi</span>
                </TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {packagesQuery.data.items.map((row) =>
                editingId === row.id ? (
                  <TableRow key={row.id}>
                    <TableCell colSpan={5} className="bg-subtle/60">
                      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,0.8fr))]">
                        <Input
                          id={`package-name-${row.id}`}
                          label="Nama paket"
                          value={draft.name}
                          onChange={(event) =>
                            setDraft((previous) => ({ ...previous, name: event.target.value }))
                          }
                        />
                        <Input
                          id={`package-duration-${row.id}`}
                          label="Durasi (menit)"
                          inputMode="numeric"
                          value={draft.duration}
                          onChange={(event) =>
                            setDraft((previous) => ({
                              ...previous,
                              duration: event.target.value.replace(/[^\d]/g, '')
                            }))
                          }
                        />
                        <Input
                          id={`package-price-${row.id}`}
                          label="Harga (Rp)"
                          inputMode="numeric"
                          value={draft.price}
                          onChange={(event) =>
                            setDraft((previous) => ({
                              ...previous,
                              price: addThousandsSeparatorOnInput(event.target.value)
                            }))
                          }
                          hint={
                            parseIntInput(draft.price) > 0
                              ? formatIDR(parseIntInput(draft.price))
                              : 'Rupiah penuh, tanpa desimal.'
                          }
                        />
                      </div>
                      {draftError ? (
                        <p role="alert" className="mt-2 text-[13px] font-semibold text-danger">
                          {draftError}
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => saveEdit()}
                          disabled={update.isPending}
                        >
                          {update.isPending ? 'Menyimpan…' : 'Simpan'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingId(null);
                            setDraftError(null);
                            setEditConfirmOpen(false);
                            update.reset();
                          }}
                          disabled={update.isPending}
                        >
                          Batal
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={row.id}>
                    <TableCell>
                      <p className="font-semibold text-textMain">{row.name}</p>
                      {row.description ? (
                        <p className="mt-0.5 line-clamp-2 text-[13px] text-textSecondary">
                          {row.description}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="tnum">{durationLabel(row.duration_minutes)}</span>
                    </TableCell>
                    <TableCell align="right">
                      <span className="tnum font-semibold">{formatIDR(row.base_price_idr)}</span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={row.is_active ? 'ok' : 'muted'}>
                        {row.is_active ? 'Aktif' : 'Nonaktif'}
                      </StatusBadge>
                    </TableCell>
                    <TableCell align="right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startEdit(row)}
                          disabled={!canWrite || update.isPending || remove.isPending}
                          title={canWrite ? undefined : 'Hanya admin finance dan admin super.'}
                          icon={<Pencil aria-hidden className="h-4 w-4" />}
                        >
                          Ubah
                        </Button>
                        {row.is_active ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              remove.reset();
                              setRemoveTarget(row);
                            }}
                            disabled={!canWrite || remove.isPending}
                            title={canWrite ? undefined : 'Hanya admin finance dan admin super.'}
                            icon={<PauseCircle aria-hidden className="h-4 w-4" />}
                          >
                            Nonaktifkan
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => update.mutate({ id: row.id, patch: { is_active: true } })}
                            disabled={!canWrite || update.isPending}
                            title={canWrite ? undefined : 'Hanya admin finance dan admin super.'}
                            icon={<RotateCw aria-hidden className="h-4 w-4" />}
                          >
                            Aktifkan
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              )}
            </TableBody>
          </Table>
        ) : null}
      </Card>

      <Modal open={addOpen} onClose={closeAdd} labelledBy="add-package-title" size="md">
        <h2 id="add-package-title" className="pr-10 text-xl font-bold tracking-[-0.01em]">
          Tambah paket
        </h2>
        <p className="mt-1.5 text-base leading-relaxed text-textSecondary">
          Harga diisi rupiah penuh. Paket aktif langsung bisa dipakai untuk booking baru.
        </p>

        <form
          className="mt-5 space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setNewTouched(true);
            if (newInvalid) return;
            create.mutate();
          }}
        >
          <Input
            id="new-package-name"
            label="Nama paket"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Contoh: Paket hiburan 3 jam"
            error={newTouched ? newNameError : null}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="new-package-duration"
              label="Durasi (menit)"
              inputMode="numeric"
              value={newDuration}
              onChange={(event) => setNewDuration(event.target.value.replace(/[^\d]/g, ''))}
              placeholder="180"
              hint="Contoh: 180 = 3 jam."
              error={newTouched ? newDurationError : null}
            />
            <Input
              id="new-package-price"
              label="Harga (Rp)"
              inputMode="numeric"
              value={newPrice}
              onChange={(event) => setNewPrice(addThousandsSeparatorOnInput(event.target.value))}
              placeholder="5.000.000"
              hint={
                parseIntInput(newPrice) > 0
                  ? formatIDR(parseIntInput(newPrice))
                  : 'Rupiah penuh, tanpa desimal.'
              }
              error={newTouched ? newPriceError : null}
            />
          </div>
          <Textarea
            id="new-package-description"
            label="Deskripsi (opsional)"
            value={newDescription}
            onChange={(event) => setNewDescription(event.target.value)}
            placeholder="Apa yang termasuk dalam paket ini?"
          />
          <Checkbox
            id="new-package-active"
            label="Langsung aktifkan paket"
            checked={newActive}
            onChange={() => setNewActive((previous) => !previous)}
          />

          {create.isError ? (
            <Alert tone="danger" title="Paket gagal dibuat">
              {create.error.message}
            </Alert>
          ) : null}

          <div className="sticky -bottom-5 z-10 -mx-5 -mb-5 mt-2 flex flex-col-reverse gap-2 border-t border-border bg-surface/95 px-5 py-4 backdrop-blur sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:flex-row sm:justify-end sm:px-6">
            <Button variant="outline" onClick={closeAdd} disabled={create.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Menyimpan…' : 'Simpan paket'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={editConfirmOpen}
        onClose={() => {
          if (update.isPending) return;
          setEditConfirmOpen(false);
          update.reset();
        }}
        title="Simpan perubahan paket?"
        description={
          editingRow ? (
            <>
              {editingRow.name} → {draft.name.trim()}
              {priceChanged ? (
                <>
                  {' '}
                  · harga {formatIDR(editingRow.base_price_idr)} → {formatIDR(editingPrice)}
                </>
              ) : null}
            </>
          ) : (
            ''
          )
        }
        consequence={
          priceChanged
            ? 'Harga baru hanya berlaku untuk booking yang dibuat setelah ini. Booking lama tetap memakai harga saat dipesan.'
            : 'Perubahan nama dan durasi langsung berlaku untuk booking baru.'
        }
        confirmLabel="Simpan perubahan"
        tone="primary"
        pending={update.isPending}
        error={update.isError ? update.error.message : null}
        onConfirm={() => {
          if (!editingId) return;
          update.mutate({
            id: editingId,
            patch: {
              name: draft.name.trim(),
              duration_minutes: parseIntInput(draft.duration),
              base_price_idr: editingPrice
            }
          });
        }}
        labelledBy="edit-package-confirm-title"
      />

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => {
          if (remove.isPending) return;
          setRemoveTarget(null);
          remove.reset();
        }}
        title="Nonaktifkan paket ini?"
        description={removeTarget ? `${removeTarget.name} tidak akan ditawarkan untuk booking baru.` : ''}
        consequence="Booking yang sudah ada tetap merujuk ke paket ini; riwayat dan harga lama tidak berubah. Paket bisa diaktifkan lagi nanti."
        confirmLabel="Ya, nonaktifkan"
        pending={remove.isPending}
        error={remove.isError ? remove.error.message : null}
        onConfirm={() => {
          if (removeTarget) remove.mutate(removeTarget);
        }}
        labelledBy="deactivate-package-title"
      />
    </>
  );
}
