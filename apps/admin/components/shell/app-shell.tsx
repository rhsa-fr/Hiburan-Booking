'use client';

import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  CalendarDays,
  LayoutDashboard,
  Menu,
  ScrollText,
  Settings2,
  Store,
  Wallet,
  X
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AvatarStack,
  Button,
  GlobalSearch,
  IconButton,
  NotificationButton,
  Sidebar,
  Topbar,
  UserProfile,
  WorkspaceSelector
} from '@/components/ui';
import type { NotificationItem, SidebarNavGroupModel } from '@/components/ui';
import { RegionProvider, useRegion } from '@/components/workspace/region-context';
import type { RegionId } from '@/components/workspace/region-context';
import { getDashboard, getOperators } from '@/lib/api';
import { clearSession, DEFAULT_OPERATOR, readSession } from '@/lib/session';

function initialsOf(name: string): string {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'OP'
  );
}

const NAV_GROUPS: SidebarNavGroupModel[] = [
  {
    id: 'utama',
    label: 'UTAMA',
    items: [
      { id: 'dashboard', label: 'Dashboard', href: '/', icon: <LayoutDashboard className="h-[18px] w-[18px]" /> },
      { id: 'bookings', label: 'Booking', href: '/bookings', icon: <CalendarDays className="h-[18px] w-[18px]" /> },
      { id: 'vendors', label: 'Vendor', href: '/vendors', icon: <Store className="h-[18px] w-[18px]" /> },
      { id: 'release', label: 'Release', href: '/release', icon: <Wallet className="h-[18px] w-[18px]" /> }
    ]
  },
  {
    id: 'transaksi',
    label: 'TRANSAKSI',
    items: [
      {
        id: 'transaksi',
        label: 'Transaksi',
        href: '/ledger',
        icon: <BookOpen className="h-[18px] w-[18px]" />,
        submenu: [
          { id: 'ledger', label: 'Ledger', href: '/ledger' },
          { id: 'payments', label: 'Pembayaran', href: '/payments' },
          { id: 'disputes', label: 'Sengketa', href: '/disputes' }
        ]
      }
    ]
  },
  {
    id: 'pengaturan',
    label: 'PENGATURAN',
    items: [
      { id: 'settings', label: 'Platform', href: '/settings', icon: <Settings2 className="h-[18px] w-[18px]" /> },
      { id: 'audit', label: 'Audit', href: '/audit', icon: <ScrollText className="h-[18px] w-[18px]" /> }
    ]
  }
];

const SECTION_LABELS: Array<[string, string]> = [
  ['/ledger', 'Transaksi'],
  ['/payments', 'Transaksi'],
  ['/disputes', 'Transaksi'],
  ['/settings', 'Pengaturan'],
  ['/audit', 'Pengaturan']
];

/**
 * Topbar hanya memuat konteks section, bukan judul halaman. Judul yang
 * sebenarnya ada di blok halaman (h1), jadi tidak ada judul yang dobel.
 */
function sectionLabel(pathname: string): string {
  const match = SECTION_LABELS.find(([prefix]) => pathname.startsWith(prefix));
  return match?.[1] ?? 'Operasi';
}

function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [operator, setOperator] = useState(DEFAULT_OPERATOR);
  const searchRef = useRef<HTMLInputElement>(null);
  const { region, setRegion, options } = useRegion();

  const operatorsQuery = useQuery({ queryKey: ['operators'], queryFn: getOperators });
  const dashboardQuery = useQuery({ queryKey: ['dashboard'], queryFn: getDashboard });

  useEffect(() => {
    const session = readSession();
    if (session) setOperator(session);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  function submitSearch() {
    const query = search.trim();
    router.push(query ? `/bookings?q=${encodeURIComponent(query)}` : '/bookings');
  }

  function logout() {
    clearSession();
    router.push('/login');
  }

  const notificationItems: NotificationItem[] = (dashboardQuery.data?.queue ?? []).map(
    (item) => ({
      id: item.id,
      title: item.title,
      description: `${item.code} · ${item.detail}`,
      href: item.href
    })
  );

  const sidebarProps = {
    collapsed,
    onToggleCollapse: () => setCollapsed((previous) => !previous),
    groups: NAV_GROUPS,
    pathname,
    brandLabel: 'Tarlink',
    workspace: (
      <WorkspaceSelector
        value={region}
        options={options}
        onChange={(id) => setRegion(id as RegionId)}
        collapsed={collapsed}
      />
    ),
    footer: (
      <div className={collapsed ? 'flex justify-center' : 'space-y-3'}>
        {collapsed ? (
          <AvatarStack
            people={[{ name: operator.operator_name, tone: 'dark' }]}
            max={1}
          />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-textMain text-[11px] font-bold text-white"
              >
                {initialsOf(operator.operator_name)}
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-[13px] font-semibold text-textMain">
                  {operator.operator_name}
                </span>
                <span className="block truncate text-[11.5px] text-textMuted">{operator.role}</span>
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              iconAfter={<span aria-hidden>→</span>}
              className="w-full justify-start px-3"
            >
              Keluar
            </Button>
            <p className="text-[11.5px] leading-snug text-textMuted">
              Terhubung ke API{'\u00a0'}· data langsung dari server.
            </p>
          </>
        )}
      </div>
    )
  };

  return (
    <div className="min-h-screen bg-page">
      <a
        href="#konten"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-field focus:bg-primary focus:px-4 focus:py-3 focus:text-base focus:font-semibold focus:text-white"
      >
        Lewati ke konten utama
      </a>

      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:block">
        <Sidebar {...sidebarProps} />
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            aria-hidden
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 animate-fade-in bg-textMain/40"
          />
          <div className="absolute inset-y-0 left-0 animate-drawer-in">
            <Sidebar {...sidebarProps} onNavigate={() => setMobileOpen(false)} />
          </div>
          <IconButton
            label="Tutup menu navigasi"
            icon={<X aria-hidden className="h-5 w-5" />}
            onClick={() => setMobileOpen(false)}
            className="absolute right-3 top-3"
          />
        </div>
      ) : null}

      <div className={collapsed ? 'lg:pl-[76px]' : 'lg:pl-[250px]'}>
        <div className="sticky top-0 z-30 bg-page/90 backdrop-blur-sm">
          <Topbar
            title={sectionLabel(pathname)}
            leading={
              <IconButton
                label="Buka menu navigasi"
                icon={<Menu aria-hidden className="h-5 w-5" />}
                onClick={() => setMobileOpen(true)}
                variant="ghost"
                className="w-10 min-h-10 lg:hidden"
              />
            }
            trailing={
              <>
                <div className="hidden sm:block">
                  <AvatarStack
                    people={(operatorsQuery.data ?? []).map((operator, index) => ({
                      name: operator.name,
                      tone: index === 0 ? 'dark' : index === 1 ? 'primary' : 'ok'
                    }))}
                  />
                </div>
                <NotificationButton items={notificationItems} />
                <div className="hidden w-[260px] md:block">
                  <GlobalSearch
                    value={search}
                    onChange={setSearch}
                    onSubmit={submitSearch}
                    inputRef={searchRef}
                  />
                </div>
                <UserProfile
                  name={operator.operator_name}
                  role={operator.role}
                  onLogout={logout}
                />
              </>
            }
          />
        </div>

        <main id="konten" className="mx-auto w-full max-w-[1440px] px-4 pb-10 pt-5 sm:px-7">
          {children}
        </main>

        <footer className="mx-auto w-full max-w-[1440px] px-4 pb-8 sm:px-7">
          <p className="border-t border-border pt-4 text-sm text-textMuted">
            Tarlink Admin · data langsung dari API · tindakan operator tercatat di audit.
          </p>
        </footer>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <RegionProvider>
      <Shell>{children}</Shell>
    </RegionProvider>
  );
}
