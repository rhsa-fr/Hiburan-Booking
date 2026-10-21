'use client';

import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type RegionId = 'all' | 'Indramayu' | 'Cirebon';

export interface WorkspaceOptionModel {
  id: RegionId;
  label: string;
  hint: string;
}

/**
 * Workspace = wilayah kerja. Satu sumber kebenaran untuk filter kota pada
 * daftar vendor dan daftar booking, jadi memilih di sidebar langsung mengubah
 * isi kedua halaman.
 */
export const REGION_OPTIONS: WorkspaceOptionModel[] = [
  { id: 'all', label: 'Indramayu + Cirebon', hint: 'Dua wilayah pilot' },
  { id: 'Indramayu', label: 'Indramayu', hint: 'Kota dan kabupaten Indramayu' },
  { id: 'Cirebon', label: 'Cirebon', hint: 'Kota dan kabupaten Cirebon' }
];

interface RegionContextValue {
  region: RegionId;
  setRegion: (region: RegionId) => void;
  /** Nilai yang dipakai sebagai filter kota di API: '' berarti semua kota. */
  cityFilter: string;
  options: WorkspaceOptionModel[];
}

const RegionContext = createContext<RegionContextValue | null>(null);

export function RegionProvider({ children }: { children: ReactNode }) {
  const [region, setRegion] = useState<RegionId>('all');

  const value = useMemo<RegionContextValue>(
    () => ({
      region,
      setRegion,
      cityFilter: region === 'all' ? '' : region,
      options: REGION_OPTIONS
    }),
    [region]
  );

  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
}

export function useRegion(): RegionContextValue {
  const context = useContext(RegionContext);
  if (!context) {
    throw new Error('useRegion harus dipakai di dalam RegionProvider.');
  }
  return context;
}
