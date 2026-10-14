import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, BrlPipe, DateBRPipe } from '../core';

const EMPTY = () => ({ plate: '', model: '', year: null, color: '', fipe_code: '', fipe_price: null } as any);

@Component({
  selector: 'ap-avaliacao', standalone: true, imports: [FormsModule, BrlPipe, DateBRPipe],
  template: `
  <div class="page-head">
    <div><h1>Avaliação</h1><p class="muted">Calcule o preço máximo de compra a partir da FIPE e do mercado.</p></div>
  </div>

  <div class="grid g2-1">
    <div>
      <div class="card">
        <div class="card-head"><h2>Veículo</h2></div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <input [(ngModel)]="plate" placeholder="Placa (ABC1D23)" maxlength="8" aria-label="Placa" (keydown.enter)="byPlate()" />
          <button class="btn primary" (click)="byPlate()" [disabled]="busy || !plate.trim()">Buscar placa</button>
        </div>
        <p class="muted small" style="margin:4px 0 10px">ou consultar pela tabela FIPE:</p>
        <div class="form-grid">
          <label>Marca <select [(ngModel)]="fb" (ngModelChange)="loadModels()"><option [ngValue]="null">Selecione…</option>@for (b of brands(); track b.code) { <option [ngValue]="b.code">{{ b.name }}</option> }</select></label>
          <label>Modelo <select [(ngModel)]="fm" (ngModelChange)="loadYears()" [disabled]="!models().length"><option [ngValue]="null">Selecione…</option>@for (m of models(); track m.code) { <option [ngValue]="m.code">{{ m.name }}</option> }</select></label>
          <label>Ano <select [(ngModel)]="fy" (ngModelChange)="loadPrice()" [disabled]="!years().length"><option [ngValue]="null">Selecione…</option>@for (y of years(); track y.code) { <option [ngValue]="y.code">{{ y.name }}</option> }</select></label>
        </div>

        @if (v.model) {
          <div class="mt" style="padding:12px;background:var(--muted);border-radius:var(--radius)">
            <strong>{{ v.model }}</strong> · {{ v.year }}
            @if (v.fipe_price) { <span class="muted"> · FIPE {{ v.fipe_price | brl }}</span> }
          </div>
        }

        <label class="mt" style="display:block">Modelo (texto livre) <input [(ngModel)]="v.model" placeholder="Ex.: Honda Civic EXL 2.0" /></label>

        <details class="mt">
          <summary>Ajustes</summary>
          <div class="form-grid mt">
            <label>Margem desejada (%) <input type="number" step="0.1" [(ngModel)]="p.margin_pct" /></label>
            <label>Comissão (%) <input type="number" step="0.1" [(ngModel)]="p.commission_pct" /></label>
            <label>Preparação (R$) <input type="number" [(ngModel)]="p.prep_cost" /></label>
            <label>Documentação (R$) <input type="number" [(ngModel)]="p.docs_cost" /></label>
            <label>Outros custos (R$) <input type="number" [(ngModel)]="p.other_cost" /></label>
          </div>

          <h3 class="mt" style="margin-bottom:8px">Referências de mercado</h3>
          <div class="list">
            @for (r of refs(); track $index) {
              <div class="list-item">
                <div style="flex:1;min-width:0"><strong>{{ r.price | brl }}</strong> <span class="muted small">{{ r.source }}</span>
                  <div class="small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">@if (r.url) { <a [href]="r.url" target="_blank" rel="noopener">{{ r.title }}</a> } @else { {{ r.title }} }</div></div>
                <button class="icon-btn" (click)="removeRef($index)" aria-label="Remover referência">✕</button>
              </div>
            } @empty { <div class="empty">Nenhuma referência manual.</div> }
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <input [(ngModel)]="manual.title" placeholder="Fonte / anúncio" aria-label="Fonte" />
            <input type="number" step="0.01" [(ngModel)]="manual.price" placeholder="Preço" aria-label="Preço" style="max-width:140px" />
            <button class="btn" (click)="addRef()" [disabled]="!manual.price">Adicionar</button>
          </div>
          <label class="check mt"><input type="checkbox" [(ngModel)]="useFipe" /> Incluir FIPE na média</label>
          <button class="btn mt" style="width:100%" (click)="calc()" [disabled]="busy">Recalcular</button>
        </details>
      </div>
    </div>

    <div>
      @if (res(); as r) {
        <div class="card result-box">
          <div class="stat-label">Preço máximo de compra</div>
          <div class="big">{{ r.max_price | brl }}</div>
          <div class="kv"><span>Valor de mercado</span><strong>{{ r.market_value | brl }}</strong></div>
          <div class="kv"><span>Custos totais</span><strong class="down">{{ r.costs | brl }}</strong></div>
          <div class="kv"><span>Lucro estimado ({{ r.params.margin_pct }}%)</span><strong class="up">{{ r.est_profit | brl }}</strong></div>
          <button class="btn primary mt" style="width:100%" (click)="save()" [disabled]="busy || !v.model">Salvar avaliação</button>
        </div>
      }
    </div>
  </div>

  <div class="card mt" style="padding:0">
    <div class="card-head" style="padding:16px 16px 0"><h2>Histórico</h2></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Data</th><th>Veículo</th><th>Placa</th><th class="right">FIPE</th><th class="right">Mercado</th><th class="right">Máx. compra</th><th class="right">Lucro est.</th><th></th></tr></thead>
        <tbody>
          @for (a of hist(); track a.id) {
            <tr>
              <td class="nowrap">{{ a.created_at | dateBR }}</td>
              <td><strong>{{ a.model }}</strong><div class="muted small">{{ a.year }} {{ a.color }}</div></td>
              <td class="mono">{{ a.plate || '—' }}</td>
              <td class="right nowrap">{{ a.fipe_price | brl }}</td>
              <td class="right nowrap">{{ a.market_value | brl }}</td>
              <td class="right nowrap"><strong>{{ a.max_price | brl }}</strong></td>
              <td class="right nowrap up">{{ a.est_profit | brl }}</td>
              <td class="right nowrap"><button class="btn sm" (click)="load(a)">Abrir</button> <button class="btn sm danger" (click)="remove(a)">Excluir</button></td>
            </tr>
          } @empty { <tr><td colspan="8" class="empty">Nenhuma avaliação salva.</td></tr> }
        </tbody>
      </table>
    </div>
  </div>`,
})
export class AvaliacaoPage {
  private api = inject(Api);
  v: any = EMPTY(); p: any = {}; plate = ''; useFipe = true; busy = false;
  manual: any = { title: '', price: null };
  refs = signal<any[]>([]);
  res = signal<any>(null);
  hist = signal<any[]>([]);
  brands = signal<any[]>([]); models = signal<any[]>([]); years = signal<any[]>([]);
  fb: any = null; fm: any = null; fy: any = null;

  constructor() {
    this.api.get('/appraisals/defaults').then(d => this.p = { ...d }).catch(() => {});
    this.api.get('/appraisals/fipe/brands').then(b => this.brands.set(b)).catch(() => {});
    this.loadHist();
  }
  async loadHist() { const h = await this.api.act(() => this.api.get('/appraisals')); if (h) this.hist.set(h); }

  private async run<T>(fn: () => Promise<T>, ok?: any) { this.busy = true; try { return await this.api.act(fn, ok); } finally { this.busy = false; } }

  async byPlate() {
    const r = await this.run(() => this.api.get(`/appraisals/plate/${encodeURIComponent(this.plate.trim())}`), 'Placa encontrada');
    if (!r) return;
    this.v = { ...this.v, plate: r.plate, model: [r.brand, r.model, r.version].filter(Boolean).join(' '), year: r.year, color: r.color,
      fipe_code: r.fipe_code || this.v.fipe_code, fipe_price: r.fipe_price || this.v.fipe_price };
    this.auto();
  }

  async loadModels() {
    this.models.set([]); this.years.set([]); this.fm = this.fy = null;
    if (this.fb == null) return;
    const m = await this.api.act(() => this.api.get(`/appraisals/fipe/brands/${this.fb}/models`)); if (m) this.models.set(m);
  }
  async loadYears() {
    this.years.set([]); this.fy = null;
    if (this.fm == null) return;
    const y = await this.api.act(() => this.api.get(`/appraisals/fipe/brands/${this.fb}/models/${this.fm}/years`)); if (y) this.years.set(y);
  }
  async loadPrice() {
    if (this.fy == null) return;
    const f = await this.run(() => this.api.get(`/appraisals/fipe/brands/${this.fb}/models/${this.fm}/years/${this.fy}`));
    if (!f) return;
    this.v = { ...this.v, model: `${f.brand} ${f.model}`, year: f.modelYear, fipe_code: f.codeFipe, fipe_price: f.value };
    this.auto();
  }

  async auto() {
    this.refs.set([]);
    await this.fetchMarket();
    await this.calc();
  }

  async fetchMarket() {
    const r = await this.run(() => this.api.get('/appraisals/market', { q: this.v.model, year: this.v.year || '' }),
      (r: any) => r.refs.length ? `${r.refs.length} anúncios · média ${r.average.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : 'Nenhum anúncio encontrado');
    if (r) this.refs.update(x => [...x, ...r.refs]);
  }
  addRef() { this.refs.update(x => [...x, { source: 'Manual', title: this.manual.title || 'Referência manual', price: Number(this.manual.price) }]); this.manual = { title: '', price: null }; }
  removeRef(i: number) { this.refs.update(x => x.filter((_, j) => j !== i)); }

  private body() { return { ...this.v, market_refs: this.refs(), fipe_price: this.useFipe ? this.v.fipe_price : null, use_fipe: this.useFipe, params: this.p }; }
  async calc() { const r = await this.run(() => this.api.post('/appraisals/calculate', this.body())); if (r) this.res.set(r); }
  async save() { if (await this.run(() => this.api.post('/appraisals', this.body()), 'Avaliação salva')) this.loadHist(); }

  load(a: any) {
    this.v = { plate: a.plate || '', model: a.model, year: a.year, color: a.color || '', fipe_code: a.fipe_code || '', fipe_price: a.fipe_price };
    this.refs.set(a.market_refs || []); this.p = { ...this.p, ...a.params };
    this.res.set({ params: a.params, market_value: a.market_value, max_price: a.max_price, est_profit: a.est_profit,
      costs: Math.round(a.market_value - a.max_price - a.est_profit) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async remove(a: any) {
    if (!confirm(`Excluir a avaliação de ${a.model}?`)) return;
    if (await this.api.act(() => this.api.del(`/appraisals/${a.id}`), 'Avaliação excluída')) this.loadHist();
  }
}
