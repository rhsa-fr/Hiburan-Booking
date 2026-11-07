import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // --- Token acuan visual: northstar dashboard ---
        // Kertas hangat + kartu putih bergaris rambut + sidebar hampir hitam.
        page: '#ECEBE6',
        surface: '#FBFBF9',
        card: '#FFFFFF',
        subtle: '#F4F4F2',
        sidebar: '#171816',
        sidebarSoft: '#232522',
        sidebarLine: '#2C302A',
        sidebarInk: '#E9ECE6',
        sidebarMuted: '#8F968C',
        textMain: '#15171A',
        textSecondary: '#3D4249',
        // Sengaja lebih gelap dari referensi agar lolos kontras AA.
        textMuted: '#5F6B76',
        border: '#ECECEB',
        borderSoft: '#F1F1EF',
        // Aksi utama tetap gelap; kapur tinggal di `accent`, bukan di `primary`.
        primary: '#15171A',
        primaryDeep: '#272B30',
        primarySoft: '#F4F4F2',
        accent: '#C8F751',
        accentDeep: '#B6E83C',
        accentInk: '#17210A',
        accentText: '#417A12',
        accentSoft: '#EEFBD5',
        ok: '#4BA82E',
        okInk: '#417A12',
        okSoft: '#EEFBD5',
        danger: '#C02C5C',
        dangerSoft: '#FDE8EE',
        info: '#3B82F6',
        infoInk: '#1D4ED8',
        violet: '#9333EA',
        pink: '#D9488B',
        // --- Token lama (app pelanggan), dipertahankan untuk kompatibilitas ---
        canvas: '#FAF7F0',
        ink: '#14201E',
        muted: '#5B6B66',
        line: '#E4DED2',
        teal: {
          DEFAULT: '#0B3B36',
          soft: '#E7F0EE'
        },
        ochre: {
          DEFAULT: '#E08A2C',
          soft: '#FDF0DF'
        }
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'Segoe UI', 'sans-serif']
      },
      borderRadius: {
        card: '14px',
        field: '10px',
        sm: '8px'
      },
      boxShadow: {
        soft: '0 1px 2px rgba(20, 22, 18, 0.04)',
        pop: '0 12px 34px -10px rgba(20, 22, 18, 0.18)',
        tooltip: '0 10px 25px rgba(16, 24, 40, 0.1)'
      },
      fontSize: {
        kpi: ['21px', '26px']
      }
    }
  },
  plugins: []
};

export default config;
