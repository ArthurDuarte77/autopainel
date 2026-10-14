import { Component, Input, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, Routes } from '@angular/router';
import { Auth, Toast, authGuard, monthName, thisMonth } from './core';

// Minimal stroke icon set (lucide-style paths).
const ICONS: Record<string, string[]> = {
  dashboard: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  car: ['M5 17h14', 'M5 17a2 2 0 1 0 4 0', 'M15 17a2 2 0 1 0 4 0', 'M3 17v-5l2-5h14l2 5v5', 'M3 12h18'],
  megaphone: ['M3 11v3l13 5V6L3 11z', 'M16 8a4 4 0 0 1 0 8', 'M7 15v4h3'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8'],
  wallet: ['M3 7h18v13H3z', 'M3 7l3-4h12l3 4', 'M16 13h2'],
  calc: ['M5 2h14v20H5z', 'M8 6h8', 'M8 11h2', 'M14 11h2', 'M8 15h2', 'M14 15h2', 'M8 19h2', 'M14 19h2'],
  calendar: ['M3 5h18v16H3z', 'M3 10h18', 'M8 3v4', 'M16 3v4'],
  plug: ['M9 2v6', 'M15 2v6', 'M6 8h12v4a6 6 0 0 1-12 0z', 'M12 18v4'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  menu: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
};

@Component({
  selector: 'ap-icon', standalone: true,
  template: `<svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    @for (d of paths; track $index) { <path [attr.d]="d" /> }</svg>`,
})
export class Icon {
  @Input() name = '';
  @Input() size = 18;
  get paths() { return ICONS[this.name] || []; }
}

@Component({
  selector: 'app-root', standalone: true, imports: [RouterOutlet],
  template: `<router-outlet />
    <div class="toasts" role="status" aria-live="polite">
      @for (t of toast.items(); track t.id) { <div class="toast" [class.error]="t.error">{{ t.text }}</div> }
    </div>`,
})
export class AppComponent { toast = inject(Toast); }

@Component({
  selector: 'ap-shell', standalone: true, imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  template: `
  <div class="layout" [class.open]="menu">
    <aside class="sidebar">
      <div class="brand"><span class="logo">A</span> AutoPainel</div>
      <nav>
        @for (n of nav; track n.path) {
          <a [routerLink]="n.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: n.path === '/' }" (click)="menu = false">
            <ap-icon [name]="n.icon" /> {{ n.label }}
          </a>
        }
      </nav>
      <button class="nav-logout" (click)="auth.logout()"><ap-icon name="logout" /> Sair</button>
    </aside>
    <div class="backdrop" (click)="menu = false"></div>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn menu-btn" (click)="menu = !menu" aria-label="Menu"><ap-icon name="menu" /></button>
        <span class="muted">{{ auth.user()?.store || 'AutoPainel' }} · {{ month }}</span>
        <span class="spacer"></span>
        <span class="avatar" [title]="auth.user()?.name">{{ initials }}</span>
      </header>
      <main class="content"><router-outlet /></main>
    </div>
  </div>`,
})
export class Shell {
  auth = inject(Auth);
  menu = false;
  month = monthName(thisMonth());
  nav = [
    { path: '/', label: 'Dashboard', icon: 'dashboard' },
    { path: '/estoque', label: 'Estoque', icon: 'car' },
    { path: '/publicacao', label: 'Publicação', icon: 'megaphone' },
    { path: '/crm', label: 'CRM e vendas', icon: 'users' },
    { path: '/financeiro', label: 'Financeiro', icon: 'wallet' },
    { path: '/avaliacao', label: 'Avaliação de compra', icon: 'calc' },
    { path: '/agenda', label: 'Agenda', icon: 'calendar' },
    { path: '/integracoes', label: 'Integrações', icon: 'plug' },
  ];
  get initials() { return (this.auth.user()?.name || '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase(); }
  constructor() { if (this.auth.token) this.auth.refresh().catch(() => {}); }
}

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login').then(m => m.LoginPage) },
  {
    path: '', component: Shell, canActivate: [authGuard], children: [
      { path: '', loadComponent: () => import('./pages/dashboard').then(m => m.DashboardPage) },
      { path: 'estoque', loadComponent: () => import('./pages/estoque').then(m => m.EstoquePage) },
      { path: 'publicacao', loadComponent: () => import('./pages/publicacao').then(m => m.PublicacaoPage) },
      { path: 'crm', loadComponent: () => import('./pages/crm').then(m => m.CrmPage) },
      { path: 'financeiro', loadComponent: () => import('./pages/financeiro').then(m => m.FinanceiroPage) },
      { path: 'avaliacao', loadComponent: () => import('./pages/avaliacao').then(m => m.AvaliacaoPage) },
      { path: 'agenda', loadComponent: () => import('./pages/agenda').then(m => m.AgendaPage) },
      { path: 'integracoes', loadComponent: () => import('./pages/integracoes').then(m => m.IntegracoesPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
