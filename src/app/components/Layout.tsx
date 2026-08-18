import { Outlet, NavLink } from 'react-router';
import { LayoutDashboard, Users, Hotel, UserCheck, Calendar, Upload, BarChart3, Layers, ShieldCheck, LogOut, Settings, List, Moon, Sun } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { useOpsTheme } from '../design-system';

const navItems = [
  { to: '/', end: true, label: 'Dashboard', icon: LayoutDashboard },
  { to: '/athletes', label: 'Athleten', icon: Users },
  { to: '/room-types', label: 'Zimmertypen', icon: Layers },
  { to: '/hotels', label: 'Hotels', icon: Hotel },
  { to: '/events', label: 'Events', icon: Calendar },
  { to: '/assignments', label: 'Zuweisungen', icon: UserCheck },
  { to: '/analytics', label: 'Operations Cockpit', icon: BarChart3 },
  { to: '/lists', label: 'Listen', icon: List },
];

export function Layout() {
  const { user, permissions } = useAuth();
  const { mode, toggle } = useOpsTheme();
  const displayName = user?.displayName?.trim() || user?.username || 'Benutzer';
  const initials = displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'U';

  return (
    <div className="flex h-dvh min-h-[40rem] flex-col overflow-hidden bg-[var(--ops-background)] text-[var(--ops-text)]">
      <nav className="z-40 shrink-0 border-b border-[var(--ops-border)] bg-[var(--ops-surface)] shadow-[var(--ops-shadow-xs)]">
        <div className="mx-auto w-full max-w-[1920px] px-3 sm:px-5 lg:px-6">
          <div className="flex min-h-16 items-center gap-4 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-5">
              <div className="shrink-0">
                <h1 className="whitespace-nowrap text-lg font-bold text-blue-600 sm:text-xl">Freestyle WM 2027</h1>
              </div>
              <div className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto lg:flex">
                {navItems.map(({ to, end, label, icon: Icon }) => (
                  <NavLink key={to} to={to} end={end} className={({ isActive }) => `inline-flex h-10 shrink-0 items-center rounded-xl px-3 text-sm font-medium transition-colors ${isActive ? 'bg-[var(--ops-tone-primary-surface)] text-[var(--ops-primary)]' : 'text-[var(--ops-text-muted)] hover:bg-[var(--ops-surface-elevated)] hover:text-[var(--ops-text)]'}`}>
                    <Icon className="mr-2 h-4 w-4" />{label}
                  </NavLink>
                ))}
                {permissions.canManageImports && <NavLink to="/import" className={({ isActive }) => `inline-flex h-10 shrink-0 items-center rounded-xl px-3 text-sm font-medium transition-colors ${isActive ? 'bg-[var(--ops-tone-primary-surface)] text-[var(--ops-primary)]' : 'text-[var(--ops-text-muted)] hover:bg-[var(--ops-surface-elevated)] hover:text-[var(--ops-text)]'}`}><Upload className="mr-2 h-4 w-4" />Import</NavLink>}
                {permissions.canReadAudit && <NavLink to="/audit" className={({ isActive }) => `inline-flex h-10 shrink-0 items-center rounded-xl px-3 text-sm font-medium transition-colors ${isActive ? 'bg-[var(--ops-tone-primary-surface)] text-[var(--ops-primary)]' : 'text-[var(--ops-text-muted)] hover:bg-[var(--ops-surface-elevated)] hover:text-[var(--ops-text)]'}`}><ShieldCheck className="mr-2 h-4 w-4" />Aktivitäten</NavLink>}
                {permissions.isAdmin && <NavLink to="/administration" className={({ isActive }) => `inline-flex h-10 shrink-0 items-center rounded-xl px-3 text-sm font-medium transition-colors ${isActive ? 'bg-[var(--ops-tone-primary-surface)] text-[var(--ops-primary)]' : 'text-[var(--ops-text-muted)] hover:bg-[var(--ops-surface-elevated)] hover:text-[var(--ops-text)]'}`}><Settings className="mr-2 h-4 w-4" />Administration</NavLink>}
              </div>
            </div>
            <div className="flex w-[176px] shrink-0 items-center justify-end gap-2 sm:w-[244px] md:w-[288px]" title={`${displayName} · ${permissions.roleLabel}${permissions.isReadOnly ? ' · Nur-Lese-Modus' : ''}`}>
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-2.5 py-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{initials}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[var(--ops-text)]">{displayName}</div>
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="truncate text-xs text-[var(--ops-text-muted)]">{permissions.roleLabel}</span>
                    {permissions.isReadOnly && <span className="hidden rounded-full bg-[var(--ops-tone-primary-surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ops-primary)] sm:inline">Nur-Lese-Modus</span>}
                  </div>
                </div>
              </div>
              <button type="button" title={mode === 'dark' ? 'Helles Theme verwenden' : 'Dunkles Theme verwenden'} aria-label={mode === 'dark' ? 'Helles Theme verwenden' : 'Dunkles Theme verwenden'} className="shrink-0 rounded-xl p-2 text-[var(--ops-text-muted)] hover:bg-[var(--ops-surface-elevated)] hover:text-[var(--ops-text)]" onClick={toggle}>
                {mode === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
              <button title="Abmelden" className="shrink-0 rounded-xl p-2 text-[var(--ops-text-muted)] hover:bg-[var(--ops-surface-elevated)] hover:text-[var(--ops-text)]" onClick={() => window.location.assign(import.meta.env.VITE_AUTHELIA_LOGOUT_URL || '/auth/logout')}>
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto pb-2 lg:hidden">
            {navItems.map(({ to, end, label, icon: Icon }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `inline-flex h-9 shrink-0 items-center rounded-xl px-3 text-xs font-medium ${isActive ? 'bg-[var(--ops-tone-primary-surface)] text-[var(--ops-primary)]' : 'text-[var(--ops-text-muted)]'}`}><Icon className="mr-1.5 h-4 w-4" />{label}</NavLink>)}
            {permissions.canReadAudit && <NavLink to="/audit" className={({ isActive }) => `inline-flex h-9 shrink-0 items-center rounded-xl px-3 text-xs font-medium ${isActive ? 'bg-[var(--ops-tone-primary-surface)] text-[var(--ops-primary)]' : 'text-[var(--ops-text-muted)]'}`}><ShieldCheck className="mr-1.5 h-4 w-4" />Aktivitäten</NavLink>}
            {permissions.isAdmin && <NavLink to="/administration" className={({ isActive }) => `inline-flex h-9 shrink-0 items-center rounded-xl px-3 text-xs font-medium ${isActive ? 'bg-[var(--ops-tone-primary-surface)] text-[var(--ops-primary)]' : 'text-[var(--ops-text-muted)]'}`}><Settings className="mr-1.5 h-4 w-4" />Administration</NavLink>}
          </div>
        </div>
      </nav>
      <main className="mx-auto min-h-0 w-full max-w-[1920px] flex-1 overflow-y-auto px-3 py-4 sm:px-5 lg:overflow-hidden lg:px-6">
        <Outlet />
      </main>
    </div>
  );
}
