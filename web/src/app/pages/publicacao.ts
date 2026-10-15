import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, BrlPipe } from '../core';

// Main channels always visible; the rest only after "Mostrar outros canais".
// Webmotors has no adapter yet: shown as a placeholder card, never in the grid.
const MAIN = ['olx', 'mercadolivre', 'site', 'webmotors'];
const WEBMOTORS = { id: 'webmotors', name: 'Webmotors', connected: false, unavailable: true };
const ALL_KEY = 'ap_pub_all';

@Component({
  selector: 'ap-publicacao', standalone: true, imports: [RouterLink, BrlPipe],
  template: `
  <div class="page-head">
    <div><h1>Publicação</h1><p class="muted">Anuncie seu estoque em marketplaces e no seu site com um clique.</p></div>
    <div class="actions"><button class="btn primary" (click)="syncAll()" [disabled]="busy">{{ busy ? 'Sincronizando…' : 'Sincronizar tudo' }}</button></div>
  </div>

  @if (data(); as d) {
    @let cards = shown(d);
    @let cols = columns(d);
    <div class="grid g4">
      @for (c of cards; track c.id) {
        <div class="card">
          <div class="card-head" style="margin-bottom:8px">
            <h3>{{ c.name }}</h3>
            <span [class]="'badge ' + (c.connected ? 'green' : 'red')">{{ c.connected ? '✓ Conta conectada' : 'Não conectado' }}</span>
          </div>
          @if (c.unavailable) {
            <div class="small muted">Integração com a Webmotors ainda não disponível.</div>
          } @else {
            <div class="small muted">{{ c.published }} publicados · {{ c.active }} ativos</div>
            @if (!c.connected) { <div class="small" style="margin-top:8px"><a routerLink="/integracoes">Conectar conta →</a></div> }
            <div class="actions mt" style="margin-top:10px">
              <button class="btn sm" (click)="bulk(c, true)" [disabled]="busy">Publicar todos</button>
              <button class="btn sm" (click)="bulk(c, false)" [disabled]="busy">Remover todos</button>
            </div>
          }
        </div>
      }
    </div>
    <div style="margin-top:10px"><button class="btn sm" (click)="toggleAll()">{{ all ? 'Ocultar outros canais' : 'Mostrar outros canais' }}</button></div>

    <div class="card mt" style="padding:0">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Veículo</th><th>Preço</th>@for (c of cols; track c.id) { <th>{{ c.name }}</th> }</tr></thead>
          <tbody>
            @for (v of d.vehicles; track v.id) {
              <tr>
                <td><strong>{{ v.brand }} {{ v.model }}</strong><div class="muted small">{{ v.version }} · {{ v.year }} @if (v.status === 'Vendido') { · <span class="down">Vendido</span> }</div></td>
                <td class="nowrap">{{ v.price | brl }}</td>
                @for (c of cols; track c.id) {
                  <td class="nowrap">
                    @let p = v.publications[c.id];
                    <div style="display:flex;align-items:center;gap:8px">
                      <label class="switch" [title]="'Publicar em ' + c.name">
                        <input type="checkbox" [checked]="!!p?.active" [disabled]="cellBusy[v.id + c.id] || (v.status === 'Vendido' && !p?.active)" (change)="toggle(v, c, $any($event.target).checked)" [attr.aria-label]="'Publicar em ' + c.name" />
                        <span></span>
                      </label>
                      @if (p && p.status !== 'inativo') {
                        <span class="badge" [class]="'badge ' + color(p.status)" [title]="p.last_error || ''">{{ p.status }}</span>
                      }
                      @if (p?.external_url) { <a [href]="p.external_url" target="_blank" rel="noopener" class="small">ver</a> }
                      @if (p && (p.active || p.external_id)) { <button class="icon-btn small" (click)="sync(v, c)" [disabled]="cellBusy[v.id + c.id]" title="Sincronizar" aria-label="Sincronizar">⟳</button> }
                    </div>
                    @if (p?.status === 'erro' && p.last_error) { <div class="small down" style="max-width:220px;white-space:normal">{{ p.last_error }}</div> }
                  </td>
                }
              </tr>
            } @empty { <tr><td [attr.colspan]="cols.length + 2" class="empty">Nenhum veículo no estoque.</td></tr> }
          </tbody>
        </table>
      </div>
    </div>
  } @else { <div class="empty">Carregando…</div> }`,
})
export class PublicacaoPage {
  private api = inject(Api);
  data = signal<any>(null);
  busy = false;
  cellBusy: Record<string, boolean> = {};
  all = (() => { try { return localStorage.getItem(ALL_KEY) === '1'; } catch { return false; } })();

  constructor() { this.load(); }
  toggleAll() { this.all = !this.all; try { localStorage.setItem(ALL_KEY, this.all ? '1' : ''); } catch {} }
  columns(d: any) { return d.channels.filter((c: any) => this.all || MAIN.includes(c.id)); }
  shown(d: any) {
    const list = [...d.channels, ...(d.channels.some((c: any) => c.id === 'webmotors') ? [] : [WEBMOTORS])];
    return list.filter((c: any) => this.all || MAIN.includes(c.id)).sort((a: any, b: any) => (MAIN.indexOf(a.id) + 1 || 99) - (MAIN.indexOf(b.id) + 1 || 99));
  }
  async load() { const d = await this.api.act(() => this.api.get('/publications')); if (d) this.data.set(d); }
  color(s: string) { return ({ publicado: 'green', pendente: 'yellow', erro: 'red' } as any)[s] || ''; }

  private setPub(vid: number, ch: string, p: any) {
    this.data.update(d => ({ ...d, vehicles: d.vehicles.map((v: any) => v.id === vid ? { ...v, publications: { ...v.publications, [ch]: p } } : v) }));
  }
  async toggle(v: any, c: any, active: boolean) {
    const k = v.id + c.id;
    this.cellBusy[k] = true;
    const p = await this.api.act(() => this.api.put(`/publications/${v.id}/${c.id}`, { active }),
      (r: any) => r?.status === 'erro' ? `${c.name}: ${r.last_error || 'erro'}` : `${c.name}: ${active ? 'publicado' : 'removido'}`);
    this.cellBusy[k] = false;
    if (p) this.setPub(v.id, c.id, p); else this.load();
  }
  async sync(v: any, c: any) {
    const k = v.id + c.id;
    this.cellBusy[k] = true;
    const p = await this.api.act(() => this.api.post(`/publications/${v.id}/${c.id}/sync`), 'Sincronizado');
    this.cellBusy[k] = false;
    if (p) this.setPub(v.id, c.id, p);
  }
  async syncAll() {
    this.busy = true;
    await this.api.act(() => this.api.post('/publications/sync'), (r: any) => `${r.total} anúncios: ${r.publicado} publicados, ${r.pendente} pendentes, ${r.erro} com erro`);
    this.busy = false;
    this.load();
  }
  async bulk(c: any, active: boolean) {
    if (!confirm(`${active ? 'Publicar' : 'Remover'} todos os veículos disponíveis em ${c.name}?`)) return;
    this.busy = true;
    await this.api.act(() => this.api.post(`/publications/channel/${c.id}/all`, { active }), (r: any) => `${r.count} veículos atualizados em ${c.name}`);
    this.busy = false;
    this.load();
  }
}
