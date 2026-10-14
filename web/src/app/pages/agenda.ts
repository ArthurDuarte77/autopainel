import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, DateBRPipe, EVENT_CATS, MONTHS, today } from '../core';

const EMPTY = (date = today()) => ({ date, time: '09:00', title: '', category: 'Cliente', lead_id: null, vehicle_id: null, done: 0, notes: '' } as any);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const CAT_COLOR: Record<string, string> = { Cliente: 'blue', Estoque: 'green', Financeiro: 'yellow', Outro: '' };

@Component({
  selector: 'ap-agenda', standalone: true, imports: [FormsModule, DateBRPipe],
  template: `
  <div class="page-head">
    <div><h1>Agenda</h1><p class="muted">{{ events().length }} compromissos em {{ title() }}</p></div>
    <div class="actions">
      <button class="btn" (click)="move(-1)" aria-label="Mês anterior">‹</button>
      <button class="btn" (click)="goToday()">Hoje</button>
      <button class="btn" (click)="move(1)" aria-label="Próximo mês">›</button>
      <button class="btn primary" (click)="form = EMPTY(sel())">+ Compromisso</button>
    </div>
  </div>

  <div class="grid g2-1">
    <div class="card">
      <div class="cal">
        @for (d of dows; track d) { <div class="dow">{{ d }}</div> }
        @for (c of cells(); track c.date) {
          <button type="button" class="day" [class.out]="!c.inMonth" [class.today]="c.date === todayStr" [class.sel]="c.date === sel()" (click)="sel.set(c.date)" (dblclick)="form = EMPTY(c.date)">
            <span class="n">{{ c.day }}</span>
            @for (e of (byDay()[c.date] || []).slice(0, 3); track e.id) { <span class="ev" [style.text-decoration]="e.done ? 'line-through' : ''">{{ e.time?.slice(0, 5) }} {{ e.title }}</span> }
            @if ((byDay()[c.date] || []).length > 3) { <span class="small muted">+{{ byDay()[c.date].length - 3 }}</span> }
          </button>
        }
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>{{ sel() | dateBR }}</h2><button class="btn sm" (click)="form = EMPTY(sel())">+ Adicionar</button></div>
      <div class="list">
        @for (e of byDay()[sel()] || []; track e.id) {
          <div class="list-item">
            <input type="checkbox" [checked]="!!e.done" (change)="toggle(e)" [attr.aria-label]="'Concluir ' + e.title" />
            <div style="flex:1;min-width:0;cursor:pointer" (click)="open(e)" tabindex="0" (keydown.enter)="open(e)">
              <div [style.text-decoration]="e.done ? 'line-through' : ''"><strong>{{ e.time?.slice(0, 5) }}</strong> {{ e.title }}</div>
              <div class="small muted">
                <span class="badge" [class]="'badge ' + color(e.category)">{{ e.category }}</span>
                @if (e.lead_name) { · {{ e.lead_name }} @if (e.lead_phone) { ({{ e.lead_phone }}) } }
                @if (e.vehicle_label) { · {{ e.vehicle_label }} }
              </div>
              @if (e.notes) { <div class="small muted">{{ e.notes }}</div> }
            </div>
          </div>
        } @empty { <div class="empty">Nenhum compromisso neste dia.</div> }
      </div>
    </div>
  </div>

  @if (form) {
    <div class="modal-bg" (click)="form = null">
      <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="save()" role="dialog" aria-modal="true">
        <div class="modal-head"><h2>{{ form.id ? 'Editar compromisso' : 'Novo compromisso' }}</h2><button type="button" class="icon-btn" (click)="form = null" aria-label="Fechar">✕</button></div>
        <div class="modal-body">
          <div class="form-grid">
            <label class="span2">Título* <input name="title" [(ngModel)]="form.title" required /></label>
            <label>Categoria <select name="category" [(ngModel)]="form.category">@for (c of cats; track c) { <option>{{ c }}</option> }</select></label>
            <label>Data* <input type="date" name="date" [(ngModel)]="form.date" required /></label>
            <label>Hora <input type="time" name="time" [(ngModel)]="form.time" /></label>
            <label class="check" style="align-self:end"><input type="checkbox" name="done" [(ngModel)]="form.done" /> Concluído</label>
            <label class="span2">Lead <select name="lead_id" [(ngModel)]="form.lead_id"><option [ngValue]="null">—</option>@for (l of leads(); track l.id) { <option [ngValue]="l.id">{{ l.name }}@if (l.phone) { · {{ l.phone }} }</option> }</select></label>
            <label>Veículo <select name="vehicle_id" [(ngModel)]="form.vehicle_id"><option [ngValue]="null">—</option>@for (v of vehicles(); track v.id) { <option [ngValue]="v.id">{{ v.brand }} {{ v.model }} {{ v.year }}</option> }</select></label>
            <label class="full">Observações <textarea name="notes" [(ngModel)]="form.notes" rows="3"></textarea></label>
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
  }`,
})
export class AgendaPage {
  private api = inject(Api);
  EMPTY = EMPTY; cats = EVENT_CATS; todayStr = today();
  dows = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  month = signal(today().slice(0, 7));
  sel = signal(today());
  events = signal<any[]>([]);
  leads = signal<any[]>([]);
  vehicles = signal<any[]>([]);
  form: any = null; busy = false;

  title = computed(() => { const [y, m] = this.month().split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; });
  // 6-week grid starting on the Sunday before the 1st.
  cells = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    const start = new Date(y, m - 1, 1 - new Date(y, m - 1, 1).getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { date: iso(d), day: d.getDate(), inMonth: d.getMonth() === m - 1 };
    });
  });
  byDay = computed(() => {
    const g: Record<string, any[]> = {};
    for (const e of this.events()) (g[e.date.slice(0, 10)] ||= []).push(e);
    return g;
  });

  constructor() {
    this.load();
    this.api.get('/leads').then(l => this.leads.set(l)).catch(() => {});
    this.api.get('/vehicles').then(v => this.vehicles.set(v)).catch(() => {});
  }
  color(c: string) { return CAT_COLOR[c] || ''; }
  open(e: any) { this.form = { ...e, time: e.time?.slice(0, 5) }; }
  async load() {
    const c = this.cells();
    const r = await this.api.act(() => this.api.get('/events', { from: c[0].date, to: c[c.length - 1].date }));
    if (r) this.events.set(r);
  }
  move(n: number) {
    const [y, m] = this.month().split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    this.month.set(iso(d).slice(0, 7)); this.sel.set(iso(d)); this.load();
  }
  goToday() { this.month.set(today().slice(0, 7)); this.sel.set(today()); this.load(); }

  async save() {
    this.busy = true;
    const { lead_name, lead_phone, vehicle_label, created_at, ...b } = this.form;
    const r = await this.api.act(() => b.id ? this.api.put(`/events/${b.id}`, b) : this.api.post('/events', b), 'Compromisso salvo');
    this.busy = false;
    if (!r) return;
    this.form = null; this.sel.set(b.date);
    if (b.date.slice(0, 7) !== this.month()) this.month.set(b.date.slice(0, 7));
    this.load();
  }
  async toggle(e: any) { if (await this.api.act(() => this.api.put(`/events/${e.id}`, { done: !e.done }))) this.load(); }
  async remove() {
    if (!confirm(`Excluir "${this.form.title}"?`)) return;
    if (await this.api.act(() => this.api.del(`/events/${this.form.id}`), 'Compromisso excluído')) { this.form = null; this.load(); }
  }
}
