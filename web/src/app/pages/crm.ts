import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, BrlPipe, DateBRPipe, STAGES, VEHICLE_ENUMS } from '../core';

const EMPTY = () => ({
  name: '', phone: '', email: '', interest: '', brand: '', model: '', body_type: '', fuel: '', year_min: null, price_max: null,
  stage: 'Novo', seller_id: null, vehicle_id: null, source: 'manual', notes: '',
} as any);

@Component({
  selector: 'ap-crm', standalone: true, imports: [FormsModule, BrlPipe, DateBRPipe],
  template: `
  <div class="page-head">
    <div><h1>CRM</h1><p class="muted">{{ leads().length }} leads · arraste os cards entre as etapas.</p></div>
    <div class="actions"><button class="btn primary" (click)="form = EMPTY()">+ Novo lead</button></div>
  </div>

  <div class="filters">
    <input type="search" placeholder="Buscar nome, telefone, interesse…" [(ngModel)]="f.search" (input)="debounce()" aria-label="Buscar" />
    <select [(ngModel)]="f.seller_id" (change)="load()" aria-label="Vendedor"><option value="">Todos vendedores</option>@for (s of sellers(); track s.id) { <option [value]="s.id">{{ s.name }}</option> }</select>
  </div>

  <div class="kanban">
    @for (st of stages; track st) {
      <div class="column" [class.drop]="over === st" (dragover)="$event.preventDefault(); over = st" (dragleave)="over = ''" (drop)="drop(st)">
        <div class="column-head"><span>{{ st }}</span><span class="badge">{{ byStage()[st].length }}</span></div>
        @for (l of byStage()[st]; track l.id) {
          <div class="lead" draggable="true" (dragstart)="dragging = l" (dragend)="dragging = null; over = ''" (click)="edit(l)" tabindex="0" (keydown.enter)="edit(l)">
            <div class="name">{{ l.name }}</div>
            <div class="muted small">{{ l.interest || l.vehicle_label || '—' }}</div>
            <div class="muted small">{{ l.phone }}@if (l.seller_name) { · {{ l.seller_name }} }</div>
            @if (l.price_max) { <div class="small">até {{ l.price_max | brl }}</div> }
            @for (m of l.matches.slice(0, 2); track m.id) { <div class="match">Chegou: {{ m.label }} · {{ m.price | brl }}</div> }
            @if (l.source && l.source !== 'manual') { <span class="badge blue small" style="margin-top:6px">{{ l.source }}</span> }
          </div>
        } @empty { <div class="muted small" style="text-align:center;padding:12px">Vazio</div> }
      </div>
    }
  </div>

  @if (form) {
    <div class="modal-bg" (click)="form = null">
      <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="save()" role="dialog" aria-modal="true">
        <div class="modal-head"><h2>{{ form.id ? form.name : 'Novo lead' }}</h2><button type="button" class="icon-btn" (click)="form = null" aria-label="Fechar">✕</button></div>
        <div class="modal-body">
          <div class="form-grid">
            <label>Nome* <input name="name" [(ngModel)]="form.name" required /></label>
            <label>Telefone <input name="phone" [(ngModel)]="form.phone" placeholder="(11) 99999-9999" /></label>
            <label>E-mail <input type="email" name="email" [(ngModel)]="form.email" /></label>
            <label class="span2">Interesse <input name="interest" [(ngModel)]="form.interest" placeholder="Ex.: SUV automático até 120 mil" /></label>
            <label>Etapa <select name="stage" [(ngModel)]="form.stage">@for (s of stages; track s) { <option [disabled]="s === 'Fechado' && form.stage !== 'Fechado'">{{ s }}</option> }</select></label>
            <label>Marca <input name="brand" [(ngModel)]="form.brand" /></label>
            <label>Modelo <input name="model" [(ngModel)]="form.model" /></label>
            <label>Carroceria <select name="body_type" [(ngModel)]="form.body_type"><option value="">—</option>@for (s of E.body_type; track s) { <option>{{ s }}</option> }</select></label>
            <label>Combustível <select name="fuel" [(ngModel)]="form.fuel"><option value="">—</option>@for (s of E.fuel; track s) { <option>{{ s }}</option> }</select></label>
            <label>Ano mínimo <input type="number" name="year_min" [(ngModel)]="form.year_min" /></label>
            <label>Preço máximo <input type="number" step="0.01" name="price_max" [(ngModel)]="form.price_max" /></label>
            <label>Vendedor <select name="seller_id" [(ngModel)]="form.seller_id"><option [ngValue]="null">—</option>@for (s of sellers(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select></label>
            <label class="span2">Veículo de interesse <select name="vehicle_id" [(ngModel)]="form.vehicle_id"><option [ngValue]="null">—</option>@for (v of stock(); track v.id) { <option [ngValue]="v.id">{{ v.brand }} {{ v.model }} {{ v.year }} · {{ v.price | brl }}</option> }</select></label>
            <label>Origem <input name="source" [(ngModel)]="form.source" /></label>
            <label class="full">Observações <textarea name="notes" [(ngModel)]="form.notes" rows="3"></textarea></label>
          </div>

          @if (form.id) {
            @if (form.matches?.length) {
              <h3 class="mt" style="margin-bottom:8px">Veículos compatíveis no estoque</h3>
              @for (m of form.matches; track m.id) { <div class="match">{{ m.label }} · {{ m.price | brl }}</div> }
            }
            @if (crmKeys(form).length) {
              <h3 class="mt" style="margin-bottom:8px">Sincronizado com</h3>
              <div class="actions">@for (k of crmKeys(form); track k) { <span class="badge blue">{{ k }}</span> }</div>
            }
            @if (form.events?.length) {
              <h3 class="mt" style="margin-bottom:8px">Agenda</h3>
              @for (e of form.events; track e.id) { <div class="kv"><span>{{ e.title }}</span><span class="muted small">{{ e.date | dateBR }} {{ e.time?.slice(0, 5) }}</span></div> }
            }
            <h3 class="mt" style="margin-bottom:8px">WhatsApp</h3>
            <div style="display:flex;gap:8px">
              <input name="wa" [(ngModel)]="wa" placeholder="Mensagem para {{ form.name }}" [disabled]="!form.phone" aria-label="Mensagem WhatsApp" />
              <button type="button" class="btn" (click)="sendWa()" [disabled]="!form.phone || !wa.trim() || busy">Enviar</button>
            </div>
            @if (!form.phone) { <p class="muted small">Cadastre um telefone para enviar mensagens.</p> }
          }
        </div>
        <div class="modal-foot">
          @if (form.id) {
            <button type="button" class="btn danger" (click)="remove()">Excluir</button>
            <button type="button" class="btn" (click)="syncCrm()" [disabled]="busy">Enviar aos CRMs</button>
            @if (form.stage !== 'Fechado') { <button type="button" class="btn" (click)="openSell(form)">Fechar venda</button> }
          }
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
        <div class="modal-head"><h2>Fechar venda · {{ sell.name }}</h2><button type="button" class="icon-btn" (click)="sell = null" aria-label="Fechar">✕</button></div>
        <div class="modal-body" style="display:grid;gap:12px">
          <label>Veículo vendido*
            <select name="vehicle_id" [(ngModel)]="sell.vehicle_id" (ngModelChange)="pickVehicle($event)" required>
              <option [ngValue]="null">Selecione…</option>
              @for (v of stock(); track v.id) { <option [ngValue]="v.id">{{ v.brand }} {{ v.model }} {{ v.year }} · {{ v.price | brl }}</option> }
            </select>
          </label>
          <label>Valor da venda* <input type="number" step="0.01" name="sold_price" [(ngModel)]="sell.sold_price" required /></label>
          <label>Vendedor <select name="seller_id" [(ngModel)]="sell.seller_id"><option [ngValue]="null">—</option>@for (s of sellers(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select></label>
          <p class="muted small" style="margin:0">Marca o veículo como vendido, lança venda e comissão no financeiro e move o lead para Fechado.</p>
        </div>
        <div class="modal-foot"><button type="button" class="btn" (click)="sell = null">Cancelar</button><button class="btn primary" [disabled]="busy || !sell.vehicle_id">Confirmar venda</button></div>
      </form>
    </div>
  }`,
})
export class CrmPage {
  private api = inject(Api);
  stages = STAGES; E = VEHICLE_ENUMS; EMPTY = EMPTY;
  leads = signal<any[]>([]);
  sellers = signal<any[]>([]);
  stock = signal<any[]>([]);
  byStage = computed(() => Object.fromEntries(STAGES.map(s => [s, this.leads().filter(l => l.stage === s)])) as Record<string, any[]>);
  f: any = { search: '', seller_id: '' };
  form: any = null; sell: any = null; wa = ''; busy = false;
  dragging: any = null; over = '';
  private t: any;

  constructor() {
    this.load();
    this.api.get('/sellers').then(s => this.sellers.set(s.filter((x: any) => x.active))).catch(() => {});
    this.loadStock();
  }
  debounce() { clearTimeout(this.t); this.t = setTimeout(() => this.load(), 300); }
  async load() { const r = await this.api.act(() => this.api.get('/leads', this.f)); if (r) this.leads.set(r); }
  loadStock() { this.api.get('/vehicles').then(v => this.stock.set(v.filter((x: any) => x.status !== 'Vendido'))).catch(() => {}); }
  crmKeys(l: any) { return Object.keys(l.crm_refs || {}); }

  async drop(stage: string) {
    const l = this.dragging; this.over = ''; this.dragging = null;
    if (!l || l.stage === stage) return;
    if (stage === 'Fechado') return this.openSell(l); // closing a deal needs the sold vehicle
    this.leads.update(ls => ls.map(x => x.id === l.id ? { ...x, stage } : x));
    if (!await this.api.act(() => this.api.put(`/leads/${l.id}`, { stage }))) this.load();
  }

  async edit(l: any) { const full = await this.api.act(() => this.api.get(`/leads/${l.id}`)); if (full) { this.form = { ...full, matches: l.matches }; this.wa = ''; } }
  async save() {
    this.busy = true;
    const b = this.form;
    const r = await this.api.act(() => b.id ? this.api.put(`/leads/${b.id}`, b) : this.api.post('/leads', b), 'Lead salvo');
    this.busy = false;
    if (r) { this.form = null; this.load(); }
  }
  async remove() {
    if (!confirm(`Excluir o lead ${this.form.name}?`)) return;
    if (await this.api.act(() => this.api.del(`/leads/${this.form.id}`), 'Lead excluído')) { this.form = null; this.load(); }
  }
  async syncCrm() {
    this.busy = true;
    await this.api.act(() => this.api.post(`/leads/${this.form.id}/sync-crm`), (r: any) => {
      const k = Object.entries(r || {});
      if (!k.length) return 'Nenhum CRM configurado no .env';
      return k.map(([id, v]: any) => `${id}: ${v.ok ? 'ok' : v.error}`).join(' · ');
    });
    this.busy = false;
    this.load();
  }
  async sendWa() {
    this.busy = true;
    if (await this.api.act(() => this.api.post(`/leads/${this.form.id}/whatsapp`, { message: this.wa }), 'Mensagem enviada')) this.wa = '';
    this.busy = false;
  }

  openSell(l: any) {
    const vid = l.vehicle_id ?? l.matches?.[0]?.id ?? null;
    this.sell = { id: l.id, name: l.name, vehicle_id: vid, sold_price: this.stock().find(v => v.id === vid)?.price ?? null, seller_id: l.seller_id ?? null };
    this.form = null;
  }
  pickVehicle(id: number) { const v = this.stock().find(x => x.id === id); if (v) this.sell.sold_price = v.price; }
  async confirmSell() {
    this.busy = true;
    const s = this.sell;
    const r = await this.api.act(() => this.api.post(`/leads/${s.id}/sell`, s), 'Venda registrada');
    this.busy = false;
    if (r) { this.sell = null; this.load(); this.loadStock(); }
  }
}
