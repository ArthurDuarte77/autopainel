import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, BrlPipe, VEHICLE_ENUMS, today, vlabel } from '../core';

const EMPTY = () => ({
  brand: '', model: '', version: '', body_type: 'Hatch', year: new Date().getFullYear(), km: 0, plate: '', color: '',
  fuel: 'Flex', transmission: 'Manual', doors: 4, price: null, cost: null, prep_cost: 0, status: 'Disponível', description: '', seller_id: null,
} as any);

@Component({
  selector: 'ap-estoque', standalone: true, imports: [FormsModule, BrlPipe],
  template: `
  <div class="page-head">
    <div><h1>Estoque</h1><p class="muted">{{ rows().length }} veículos encontrados.</p></div>
    <div class="actions"><button class="btn primary" (click)="openNew()">+ Novo veículo</button></div>
  </div>

  <div class="filters">
    <input type="search" placeholder="Buscar marca, modelo, placa…" [(ngModel)]="f.search" (input)="debounce()" aria-label="Buscar" />
    <select [(ngModel)]="f.status" (change)="load()" aria-label="Status"><option value="">Todos status</option>@for (s of E.status; track s) { <option>{{ s }}</option> }</select>
    <select [(ngModel)]="f.brand" (change)="load()" aria-label="Marca"><option value="">Todas marcas</option>@for (b of brands(); track b) { <option>{{ b }}</option> }</select>
    <select [(ngModel)]="f.body_type" (change)="load()" aria-label="Carroceria"><option value="">Carroceria</option>@for (s of E.body_type; track s) { <option>{{ s }}</option> }</select>
    <select [(ngModel)]="f.fuel" (change)="load()" aria-label="Combustível"><option value="">Combustível</option>@for (s of E.fuel; track s) { <option>{{ s }}</option> }</select>
    <input type="number" placeholder="Preço máx." [(ngModel)]="f.price_max" (change)="load()" aria-label="Preço máximo" />
  </div>

  <div class="card" style="padding:0">
    <div class="table-wrap">
      <table>
        <thead><tr><th></th><th>Veículo</th><th>Placa</th><th>KM</th><th>Preço</th><th>Status</th><th>Dias</th><th>Anúncios</th><th></th></tr></thead>
        <tbody>
          @for (v of rows(); track v.id) {
            <tr>
              <td>@if (v.photos?.length) { <img class="thumb" [src]="v.photos[0]" alt="" /> } @else { <div class="thumb empty">sem foto</div> }</td>
              <td><strong>{{ v.brand }} {{ v.model }}</strong><div class="muted small">{{ v.version }} · {{ v.year }} · {{ v.color }}</div></td>
              <td class="mono">{{ v.plate || '—' }}</td>
              <td class="nowrap">{{ (v.km || 0).toLocaleString("pt-BR") }} km</td>
              <td class="nowrap"><strong>{{ v.price | brl }}</strong></td>
              <td><span class="badge" [class]="'badge ' + color(v.status)">{{ v.status }}</span></td>
              <td>{{ v.days_in_stock }}</td>
              <td>{{ v.published_count }}</td>
              <td class="nowrap right">
                <button class="btn sm" (click)="edit(v)">Editar</button>
                @if (v.status !== 'Vendido') { <button class="btn sm" (click)="openSell(v)">Vender</button> }
              </td>
            </tr>
          } @empty { <tr><td colspan="9" class="empty">Nenhum veículo encontrado.</td></tr> }
        </tbody>
      </table>
    </div>
  </div>

  @if (form) {
    <div class="modal-bg" (click)="form = null">
      <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="save()" role="dialog" aria-modal="true">
        <div class="modal-head"><h2>{{ form.id ? 'Editar veículo' : 'Novo veículo' }}</h2><button type="button" class="icon-btn" (click)="form = null" aria-label="Fechar">✕</button></div>
        <div class="modal-body">
          <div class="photos">
            @for (p of form.photos || []; track p) {
              <div class="photo"><img [src]="p" alt="" /><button type="button" (click)="removePhoto(p)" aria-label="Remover foto">✕</button></div>
            }
            @for (p of previews; track p) {
              <div class="photo"><img [src]="p" alt="" /><button type="button" (click)="unqueue($index)" aria-label="Remover foto">✕</button></div>
            }
            <label class="photo-add">+ Fotos<input type="file" accept="image/*" multiple (change)="upload($event)" /></label>
          </div>

          <div class="form-grid mt">
            <label>Marca* <input name="brand" [(ngModel)]="form.brand" required /></label>
            <label>Modelo* <input name="model" [(ngModel)]="form.model" required /></label>
            <label>Ano* <input type="number" name="year" [(ngModel)]="form.year" required /></label>
            <label>KM <input type="number" name="km" [(ngModel)]="form.km" /></label>
            <label>Placa <input name="plate" [(ngModel)]="form.plate" maxlength="8" /></label>
            <label>Cor <input name="color" [(ngModel)]="form.color" /></label>
            <label>Preço de venda* <input type="number" step="0.01" name="price" [(ngModel)]="form.price" required /></label>
            <label>Status <select name="status" [(ngModel)]="form.status">@for (s of E.status; track s) { <option>{{ s }}</option> }</select></label>
          </div>

          <details class="mt">
            <summary>Mais detalhes</summary>
            <div class="form-grid">
              <label>Versão <input name="version" [(ngModel)]="form.version" /></label>
              <label>Carroceria <select name="body_type" [(ngModel)]="form.body_type">@for (s of E.body_type; track s) { <option>{{ s }}</option> }</select></label>
              <label>Combustível <select name="fuel" [(ngModel)]="form.fuel">@for (s of E.fuel; track s) { <option>{{ s }}</option> }</select></label>
              <label>Câmbio <select name="transmission" [(ngModel)]="form.transmission">@for (s of E.transmission; track s) { <option>{{ s }}</option> }</select></label>
              <label>Portas <input type="number" name="doors" [(ngModel)]="form.doors" /></label>
              <label>Vendedor <select name="seller_id" [(ngModel)]="form.seller_id"><option [ngValue]="null">—</option>@for (s of sellers(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select></label>
              <label>Custo de compra <input type="number" step="0.01" name="cost" [(ngModel)]="form.cost" /></label>
              <label>Custo de preparação <input type="number" step="0.01" name="prep_cost" [(ngModel)]="form.prep_cost" /></label>
              <label class="full">Descrição <textarea name="description" [(ngModel)]="form.description" rows="3"></textarea></label>
            </div>
          </details>

          @if (form.id) {
            @if (form.publications?.length) {
              <h3 class="mt" style="margin-bottom:8px">Anúncios</h3>
              @for (p of form.publications; track p.channel) {
                <div class="kv"><span>{{ p.channel }}</span><span><span class="badge" [class]="'badge ' + pubColor(p.status)">{{ p.status }}</span>
                  @if (p.external_url) { <a [href]="p.external_url" target="_blank" rel="noopener"> ver</a> }</span></div>
              }
            }
          } @else { <p class="muted small mt"></p> }
        </div>
        <div class="modal-foot">
          @if (form.id) { <button type="button" class="btn danger" (click)="remove()">Excluir</button> }
          <span class="spacer"></span>
          <button type="button" class="btn" (click)="form = null">Cancelar</button>
          <button class="btn primary" [disabled]="busy">Salvar</button>
        </div>
      </form>
    </div>
  }

  @if (sell) {
    <div class="modal-bg" (click)="sell = null">
      <form class="modal sm" (click)="$event.stopPropagation()" (ngSubmit)="confirmSell()" role="dialog" aria-modal="true">
        <div class="modal-head"><h2>Registrar venda</h2><button type="button" class="icon-btn" (click)="sell = null" aria-label="Fechar">✕</button></div>
        <div class="modal-body" style="display:grid;gap:12px">
          <p style="margin:0"><strong>{{ sell.label }}</strong></p>
          <label>Valor da venda <input type="number" step="0.01" name="sold_price" [(ngModel)]="sell.sold_price" required /></label>
          <label>Data <input type="date" name="sold_at" [(ngModel)]="sell.sold_at" required /></label>
          <label>Vendedor
            <select name="seller_id" [(ngModel)]="sell.seller_id"><option [ngValue]="null">—</option>@for (s of sellers(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select>
          </label>
          <p class="muted small" style="margin:0">Gera lançamento de venda e comissão no financeiro e desativa os anúncios.</p>
        </div>
        <div class="modal-foot"><button type="button" class="btn" (click)="sell = null">Cancelar</button><button class="btn primary" [disabled]="busy">Confirmar venda</button></div>
      </form>
    </div>
  }`,
})
export class EstoquePage {
  private api = inject(Api);
  E = VEHICLE_ENUMS;
  rows = signal<any[]>([]);
  brands = signal<string[]>([]);
  sellers = signal<any[]>([]);
  f: any = { search: '', status: '', brand: '', body_type: '', fuel: '', price_max: '' };
  form: any = null;
  sell: any = null;
  busy = false;
  pending: File[] = [];
  previews: string[] = [];
  private t: any;

  constructor() {
    this.load();
    this.api.get('/vehicles/brands').then(b => this.brands.set(b)).catch(() => {});
    this.api.get('/sellers').then(s => this.sellers.set(s.filter((x: any) => x.active))).catch(() => {});
  }
  debounce() { clearTimeout(this.t); this.t = setTimeout(() => this.load(), 300); }
  async load() { const r = await this.api.act(() => this.api.get('/vehicles', this.f)); if (r) this.rows.set(r); }
  color(s: string) { return ({ 'Disponível': 'green', 'Reservado': 'yellow', 'Em preparação': 'blue', 'Vendido': 'red' } as any)[s] || ''; }
  pubColor(s: string) { return ({ publicado: 'green', pendente: 'yellow', erro: 'red' } as any)[s] || ''; }

  openNew() { this.form = EMPTY(); this.pending = []; this.previews = []; }
  async edit(v: any) { const full = await this.api.act(() => this.api.get(`/vehicles/${v.id}`)); if (full) this.form = full; }

  async save() {
    this.busy = true;
    const body = { ...this.form };
    const isNew = !body.id;
    const r = await this.api.act(() => isNew ? this.api.post('/vehicles', body) : this.api.put(`/vehicles/${body.id}`, body), 'Veículo salvo');
    this.busy = false;
    if (!r) return;
    if (isNew && r.id && this.pending.length) {
      const fd = new FormData();
      for (const f of this.pending) fd.append('photos', f);
      await this.api.act(() => this.api.post(`/vehicles/${r.id}/photos`, fd), 'Fotos enviadas');
      this.pending = []; this.previews = [];
    }
    this.form = null;
    this.load();
  }
  async remove() {
    if (!confirm('Excluir este veículo? Esta ação não pode ser desfeita.')) return;
    if (await this.api.act(() => this.api.del(`/vehicles/${this.form.id}`), 'Veículo excluído')) { this.form = null; this.load(); }
  }
  async upload(ev: Event) {
    const input = ev.target as HTMLInputElement;
    if (!input.files?.length) return;
    if (!this.form.id) {
      for (const f of Array.from(input.files)) { this.pending.push(f); this.previews.push(URL.createObjectURL(f)); }
      input.value = ''; return;
    }
    const fd = new FormData();
    for (const f of Array.from(input.files)) fd.append('photos', f);
    const r = await this.api.act(() => this.api.post(`/vehicles/${this.form.id}/photos`, fd), 'Fotos enviadas');
    if (r) { this.form.photos = r.photos; this.load(); }
    input.value = '';
  }
  unqueue(i: number) { URL.revokeObjectURL(this.previews[i]); this.pending.splice(i, 1); this.previews.splice(i, 1); }
  async removePhoto(url: string) {
    const r = await this.api.act(() => this.api.del(`/vehicles/${this.form.id}/photos`, { url }));
    if (r) { this.form.photos = r.photos; this.load(); }
  }

  openSell(v: any) { this.sell = { id: v.id, label: vlabel(v), sold_price: v.price, sold_at: today(), seller_id: v.seller_id ?? null }; }
  async confirmSell() {
    this.busy = true;
    const s = this.sell;
    const r = await this.api.act(() => this.api.post(`/vehicles/${s.id}/sell`, s), 'Venda registrada');
    this.busy = false;
    if (r) { this.sell = null; this.load(); }
  }
}
