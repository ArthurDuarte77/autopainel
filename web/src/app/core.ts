// Shared plumbing: API client, auth state, interceptor, guard, toasts and formatting pipes.
import { Injectable, Pipe, PipeTransform, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpInterceptorFn, HttpParams } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, firstValueFrom, throwError } from 'rxjs';

export interface User { id: number; name: string; email: string; role: string; store?: string }

const TOKEN = 'ap_token', USER = 'ap_user';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

@Injectable({ providedIn: 'root' })
export class Auth {
  private http = inject(HttpClient);
  private router = inject(Router);
  user = signal<User | null>(JSON.parse(read(USER) || 'null'));
  get token() { return read(TOKEN); }

  async login(email: string, password: string) {
    this.start(await firstValueFrom(this.http.post('/api/auth/login', { email, password })));
    await this.refresh();
  }
  async register(name: string, email: string, password: string) {
    this.start(await firstValueFrom(this.http.post('/api/auth/register', { name, email, password })));
    await this.refresh();
  }
  async auto() {
    this.start(await firstValueFrom(this.http.post('/api/auth/auto', {})));
    await this.refresh();
  }
  private start(r: any) {
    localStorage.setItem(TOKEN, r.token);
    this.setUser(r.user);
  }
  async refresh() {
    const u: any = await firstValueFrom(this.http.get('/api/auth/me'));
    this.setUser(u);
  }
  setUser(u: User) { localStorage.setItem(USER, JSON.stringify(u)); this.user.set(u); }
  logout() {
    localStorage.removeItem(TOKEN); localStorage.removeItem(USER);
    this.user.set(null);
    this.router.navigate(['/login']);
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const t = auth.token;
  if (t && req.url.startsWith('/api/')) req = req.clone({ setHeaders: { Authorization: `Bearer ${t}` } });
  return next(req).pipe(catchError((e: HttpErrorResponse) => {
    if (e.status === 401 && !req.url.endsWith('/auth/login')) auth.logout();
    return throwError(() => e);
  }));
};

export const authGuard: CanActivateFn = () => (inject(Auth).token ? true : inject(Router).parseUrl('/login'));

// Promise-based API client; every method rejects with a readable message.
@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private toast = inject(Toast);

  private async run<T>(o: any): Promise<T> {
    try { return await firstValueFrom(o) as T; }
    catch (e: any) {
      const msg = e?.error?.error || (e?.status === 0 ? 'Sem conexão com a API' : e?.message) || 'Erro inesperado';
      throw new Error(msg);
    }
  }
  private params(p?: Record<string, any>) {
    let hp = new HttpParams();
    for (const [k, v] of Object.entries(p || {})) if (v !== '' && v != null) hp = hp.set(k, String(v));
    return hp;
  }
  get<T = any>(url: string, p?: Record<string, any>) { return this.run<T>(this.http.get(`/api${url}`, { params: this.params(p) })); }
  post<T = any>(url: string, body: any = {}) { return this.run<T>(this.http.post(`/api${url}`, body)); }
  put<T = any>(url: string, body: any = {}) { return this.run<T>(this.http.put(`/api${url}`, body)); }
  del<T = any>(url: string, p?: Record<string, any>) { return this.run<T>(this.http.delete(`/api${url}`, { params: this.params(p) })); }
  async download(url: string, p: Record<string, any>, filename: string) {
    const blob = await this.run<Blob>(this.http.get(`/api${url}`, { params: this.params(p), responseType: 'blob' }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Runs an action, toasting success/failure. Returns undefined on error.
  async act<T>(fn: () => Promise<T>, ok?: string | ((r: T) => string)): Promise<T | undefined> {
    try {
      const r = await fn();
      if (ok) this.toast.show(typeof ok === 'function' ? ok(r) : ok);
      return r;
    } catch (e: any) { this.toast.show(e.message, true); return undefined; }
  }
}

@Injectable({ providedIn: 'root' })
export class Toast {
  items = signal<{ id: number; text: string; error: boolean }[]>([]);
  private seq = 0;
  show(text: string, error = false) {
    const id = ++this.seq;
    this.items.update(l => [...l, { id, text, error }]);
    setTimeout(() => this.items.update(l => l.filter(x => x.id !== id)), error ? 6000 : 3500);
  }
}

// ---------------------------------------------------------------- formatting
const nf0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = (v: any, cents = false) => (v == null || v === '' ? '—' : (cents ? nf2 : nf0).format(Number(v)));
export const thousands = (v: any) => (v == null ? '—' : `R$ ${Math.round(Number(v) / 1000).toLocaleString('pt-BR')} mil`);
export const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const monthName = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
export const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const thisMonth = () => today().slice(0, 7);
export const dateBR = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
export const vlabel = (v: any) => [v?.brand, v?.model, v?.version, v?.year].filter(Boolean).join(' ');

@Pipe({ name: 'brl', standalone: true })
export class BrlPipe implements PipeTransform { transform(v: any, cents = false) { return brl(v, cents); } }

@Pipe({ name: 'dateBR', standalone: true })
export class DateBRPipe implements PipeTransform { transform(v: any) { return dateBR(v); } }

export const VEHICLE_ENUMS = {
  body_type: ['Hatch', 'Sedã', 'SUV', 'Picape', 'Utilitário', 'Moto', 'Outro'],
  fuel: ['Flex', 'Gasolina', 'Etanol', 'Diesel', 'Híbrido', 'Elétrico'],
  transmission: ['Manual', 'Automático', 'CVT', 'Automatizado'],
  status: ['Disponível', 'Reservado', 'Em preparação', 'Vendido'],
};
export const STAGES = ['Novo', 'Em contato', 'Proposta', 'Negociação', 'Fechado', 'Perdido'];
export const TX_CATEGORIES: Record<string, string> = {
  venda: 'Venda', sinal: 'Sinal', comissao: 'Comissão', preparacao: 'Preparação', anuncio: 'Anúncio',
  aluguel: 'Aluguel', fornecedor: 'Fornecedor', imposto: 'Imposto', outros: 'Outros',
};
export const EVENT_CATS = ['Cliente', 'Estoque', 'Financeiro', 'Outro'];
