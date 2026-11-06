'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getRegions } from '@/lib/api';

/** Nama kota dipakai sebagai filter; `'all'` berarti tanpa filter. */
export type RegionId = string;

export interface WorkspaceOptionModel {
  id: RegionId;
  label: string;
  hint: string;
}

/**
 * Fallback saat API wilayah belum termuat. Daftar sebenarnya datang dari
 * `GET /admin/regions` (FR-125): hanya wilayah aktif yang ditawarkan.
 */
export const REGION_OPTIONS: WorkspaceOptionModel[] = [
  { id: 'all', label: 'Semua wilayah', hint: 'Seluruh wilayah aktif' },
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
  const [options, setOptions] = useState<WorkspaceOptionModel[]>(REGION_OPTIONS);

  useEffect(() => {
    let active = true;
    getRegions()
      .then((regions) => {
        if (!active) return;
        const cities = regions
          .filter(
            (row) => row.is_active && (row.level === 'regency' || row.level === 'city')
          )
          .map<WorkspaceOptionModel>((row) => ({
            id: row.name,
            label: row.name,
            hint: `Kode ${row.code}`
          }));
        if (cities.length === 0) return;
        setOptions([
          { id: 'all', label: 'Semua wilayah', hint: 'Seluruh wilayah aktif' },
          ...cities
        ]);
      })
      .catch(() => {
        // Filter tetap bisa dipakai dengan opsi fallback.
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<RegionContextValue>(
    () => ({
      region,
      setRegion,
      cityFilter: region === 'all' ? '' : region,
      options
    }),
    [region, options]
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
