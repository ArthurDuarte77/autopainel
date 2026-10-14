import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, BrlPipe, DateBRPipe, TX_CATEGORIES, monthName, thisMonth, today } from '../core';

const EMPTY = () => ({ date: today(), description: '', type: 'Receber', category: 'venda', amount: null, status: 'Pendente', vehicle_id: null, seller_id: null, document: '' } as any);

@Component({
  selector: 'ap-financeiro', standalone: true, imports: [FormsModule, BrlPipe, DateBRPipe],
  template: `
  <div class="page-head">
    <div><h1>Financeiro</h1><p class="muted">{{ monthName(f.month) }} · {{ rows().length }} lançamentos</p></div>
    <div class="actions">
      <input type="month" [(ngModel)]="f.month" (change)="load()" aria-label="Mês" style="width:auto" />
      <button class="btn" (click)="exportCsv()">Exportar CSV</button>
      <button class="btn" (click)="sendOpen = true">Enviar ao contador</button>
      <button class="btn primary" (click)="form = EMPTY()">+ Lançamento</button>
    </div>
  </div>

  @if (sum(); as s) {
    <div class="grid g4">
      <div class="card"><div class="stat-label">Saldo em caixa</div><div class="stat-value" [class.down]="s.saldo < 0">{{ s.saldo | brl:true }}</div><div class="small muted">Lançamentos pagos</div></div>
      <div class="card"><div class="stat-label">A receber</div><div class="stat-value up">{{ s.a_receber | brl:true }}</div><div class="small muted">Pendentes</div></div>
      <div class="card"><div class="stat-label">A pagar</div><div class="stat-value down">{{ s.a_pagar | brl:true }}</div><div class="small muted">Pendentes</div></div>
      <div class="card"><div class="stat-label">Comissões do mês</div><div class="stat-value">{{ s.comissoes_mes | brl:true }}</div>
        <div class="small muted">Entradas {{ s.entradas_mes | brl }} · Saídas {{ s.saidas_mes | brl }}</div></div>
    </div>
  }

  <div class="filters mt">
    <input type="search" placeholder="Buscar descrição ou documento…" [(ngModel)]="f.search" (input)="debounce()" aria-label="Buscar" />
    <select [(ngModel)]="f.type" (change)="load()" aria-label="Tipo"><option value="">Todos tipos</option><option>Receber</option><option>Pagar</option></select>
    <select [(ngModel)]="f.status" (change)="load()" aria-label="Status"><option value="">Todos status</option><option>Pago</option><option>Pendente</option></select>
    <select [(ngModel)]="f.category" (change)="load()" aria-label="Categoria"><option value="">Todas categorias</option>@for (c of cats; track c[0]) { <option [value]="c[0]">{{ c[1] }}</option> }</select>
  </div>

  <div class="card" style="padding:0">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Veículo / Vendedor</th><th class="right">Valor</th><th>Status</th><th></th></tr></thead>
        <tbody>
          @for (t of rows(); track t.id) {
            <tr>
              <td class="nowrap">{{ t.date | dateBR }}</td>
              <td><strong>{{ t.description }}</strong>@if (t.document) { <div class="muted small">Doc: {{ t.document }}</div> }</td>
              <td>{{ CAT[t.category] || t.category }}</td>
              <td class="small">{{ t.vehicle_label || '' }}@if (t.seller_name) { <div class="muted">{{ t.seller_name }}</div> }</td>
              <td class="right nowrap" [class.up]="t.type === 'Receber'" [class.down]="t.type === 'Pagar'"><strong>{{ t.type === 'Pagar' ? '-' : '+' }} {{ t.amount | brl:true }}</strong></td>
              <td><button class="badge" [class]="'badge ' + (t.status === 'Pago' ? 'green' : 'yellow')" style="border:0;cursor:pointer" (click)="toggle(t)" [title]="'Marcar como ' + (t.status === 'Pago' ? 'Pendente' : 'Pago')">{{ t.status }}</button></td>
              <td class="right"><button class="btn sm" (click)="open(t)">Editar</button></td>
            </tr>
          } @empty { <tr><td colspan="7" class="empty">Nenhum lançamento neste período.</td></tr> }
        </tbody>
      </table>
    </div>
  </div>

  @if (form) {
    <div class="modal-bg" (click)="form = null">
      <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="save()" role="dialog" aria-modal="true">
        <div class="modal-head"><h2>{{ form.id ? 'Editar lançamento' : 'Novo lançamento' }}</h2><button type="button" class="icon-btn" (click)="form = null" aria-label="Fechar">✕</button></div>
        <div class="modal-body">
          <div class="form-grid">
            <label>Data* <input type="date" name="date" [(ngModel)]="form.date" required /></label>
            <label>Tipo* <select name="type" [(ngModel)]="form.type"><option>Receber</option><option>Pagar</option></select></label>
            <label>Status <select name="status" [(ngModel)]="form.status"><option>Pendente</option><option>Pago</option></select></label>
            <label class="span2">Descrição* <input name="description" [(ngModel)]="form.description" required /></label>
            <label>Valor* <input type="number" step="0.01" min="0.01" name="amount" [(ngModel)]="form.amount" required /></label>
            <label>Categoria <select name="category" [(ngModel)]="form.category">@for (c of cats; track c[0]) { <option [value]="c[0]">{{ c[1] }}</option> }</select></label>
            <label>Veículo <select name="vehicle_id" [(ngModel)]="form.vehicle_id"><option [ngValue]="null">—</option>@for (v of vehicles(); track v.id) { <option [ngValue]="v.id">{{ v.brand }} {{ v.model }} {{ v.year }}</option> }</select></label>
            <label>Vendedor <select name="seller_id" [(ngModel)]="form.seller_id"><option [ngValue]="null">—</option>@for (s of sellers(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select></label>
            <label class="full">Documento / NF <input name="document" [(ngModel)]="form.document" /></label>
          </div>
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

  @if (sendOpen) {
    <div class="modal-bg" (click)="sendOpen = false">
      <form class="modal sm" (click)="$event.stopPropagation()" (ngSubmit)="send()" role="dialog" aria-modal="true">
        <div class="modal-head"><h2>Enviar ao contador</h2><button type="button" class="icon-btn" (click)="sendOpen = false" aria-label="Fechar">✕</button></div>
        <div class="modal-body" style="display:grid;gap:12px">
          <p class="muted small" style="margin:0">Envia o CSV de {{ monthName(f.month) }} por e-mail (SMTP configurado no .env).</p>
          <label>E-mail do contador <input type="email" name="email" [(ngModel)]="email" placeholder="Padrão: ACCOUNTANT_EMAIL" /></label>
        </div>
        <div class="modal-foot"><button type="button" class="btn" (click)="sendOpen = false">Cancelar</button><button class="btn primary" [disabled]="busy">{{ busy ? 'Enviando…' : 'Enviar' }}</button></div>
      </form>
    </div>
  }`,
})
export class FinanceiroPage {
  private api = inject(Api);
  EMPTY = EMPTY; monthName = monthName; CAT = TX_CATEGORIES; cats = Object.entries(TX_CATEGORIES);
  rows = signal<any[]>([]);
  sum = signal<any>(null);
  vehicles = signal<any[]>([]);
  sellers = signal<any[]>([]);
  f: any = { month: thisMonth(), search: '', type: '', status: '', category: '' };
  form: any = null; sendOpen = false; email = ''; busy = false;
  private t: any;

  constructor() {
    this.load();
    this.api.get('/vehicles').then(v => this.vehicles.set(v)).catch(() => {});
    this.api.get('/sellers').then(s => this.sellers.set(s)).catch(() => {});
  }
  open(t: any) { this.form = { ...t, date: t.date?.slice(0, 10) }; }
  debounce() { clearTimeout(this.t); this.t = setTimeout(() => this.load(), 300); }
  async load() {
    const [r, s] = await Promise.all([
      this.api.act(() => this.api.get('/finance', this.f)),
      this.api.act(() => this.api.get('/finance/summary', { month: this.f.month })),
    ]);
    if (r) this.rows.set(r);
    if (s) this.sum.set(s);
  }
  async save() {
    this.busy = true;
    const b = this.form;
    const r = await this.api.act(() => b.id ? this.api.put(`/finance/${b.id}`, b) : this.api.post('/finance', b), 'Lançamento salvo');
    this.busy = false;
    if (r) { this.form = null; this.load(); }
  }
  async toggle(t: any) {
    if (await this.api.act(() => this.api.put(`/finance/${t.id}`, { status: t.status === 'Pago' ? 'Pendente' : 'Pago' }))) this.load();
  }
  async remove() {
    if (!confirm('Excluir este lançamento?')) return;
    if (await this.api.act(() => this.api.del(`/finance/${this.form.id}`), 'Lançamento excluído')) { this.form = null; this.load(); }
  }
  exportCsv() { this.api.act(() => this.api.download('/finance/export.csv', this.f, `financeiro-${this.f.month || 'completo'}.csv`)); }
  async send() {
    this.busy = true;
    const r = await this.api.act(() => this.api.post('/finance/send-accountant', { email: this.email || undefined, month: this.f.month }),
      (r: any) => `${r.count} lançamentos enviados para ${r.to}`);
    this.busy = false;
    if (r) this.sendOpen = false;
  }
}
