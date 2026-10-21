import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // --- Token acuan visual: D:\Project\Tarlink\index.html + style.css ---
        page: '#F8F9FB',
        sidebar: '#F6F7F9',
        subtle: '#F7F8FA',
        surface: '#FFFFFF',
        primary: {
          DEFAULT: '#4E6BFF',
          soft: '#B8C7FF'
        },
        textMain: '#1A1D26',
        textSecondary: '#6C727F',
        textMuted: '#9EA3AE',
        border: '#ECEEF2',
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
        },
        ok: '#1F7A4D',
        danger: '#B3261E'
      },
      fontFamily: {
        sans: ['var(--font-jakarta)', 'system-ui', 'sans-serif']
      },
      borderRadius: {
        card: '16px',
        field: '12px',
        sm: '8px'
      },
      boxShadow: {
        soft: '0 2px 10px rgba(16, 24, 40, 0.03)',
        tooltip: '0 10px 25px rgba(16, 24, 40, 0.1)'
      },
      fontSize: {
        kpi: ['26px', '32px']
      }
    }
  },
  plugins: []
};

export default config;
