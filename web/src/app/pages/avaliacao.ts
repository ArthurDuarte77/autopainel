import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, BrlPipe, DateBRPipe } from '../core';
import { Icon } from '../app';

// Only real data: plate API, FIPE and Mercado Livre listings. Nothing is filled in when a lookup fails.
const PARAMS = () => ({ margem: 12, preparacao: 2500, impostos: 3, comissao: 1.5, outros: 800 });

@Component({
  selector: 'ap-avaliacao', standalone: true, imports: [FormsModule, BrlPipe, DateBRPipe, Icon],
  template: `
  <div class="page-head">
    <div>
      <h1>Avaliação de compra</h1>
      <p class="muted">Saiba quanto pagar no máximo antes de fechar a compra.</p>
    </div>
  </div>

  <div class="panel mb-6" style="padding:20px;margin-bottom:20px">
    <div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px">
      <label style="flex:1;min-width:220px">
        <span class="muted" style="font-weight:600">Placa do veículo</span>
        <input class="field font-mono uppercase" style="margin-top:6px;font-size:16px;letter-spacing:1px" [(ngModel)]="plate" placeholder="ABC-1D23" (keydown.enter)="consultar()" />
      </label>
      <button class="btn primary" (click)="consultar()" [disabled]="busy" style="padding:10px 20px;height:44px">
        <ap-icon name="search" /> Consultar
      </button>
    </div>
  </div>

  <div class="grid g3">
    <!-- Coluna 1: Dados do veículo e referências -->
    <section class="panel" style="padding:24px">
      <h2 style="font-size:18px;font-weight:600">Dados do veículo</h2>
      @if (v.model) {
        <dl style="margin-top:16px;display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;justify-content:space-between;font-size:14px"><dt class="muted">Modelo</dt><dd style="font-weight:600">{{ v.model }}</dd></div>
          <div style="display:flex;justify-content:space-between;font-size:14px"><dt class="muted">Ano</dt><dd style="font-weight:600">{{ v.year || '—' }}</dd></div>
          <div style="display:flex;justify-content:space-between;font-size:14px"><dt class="muted">Cor</dt><dd style="font-weight:600">{{ v.color || '—' }}</dd></div>
          <div style="display:flex;justify-content:space-between;font-size:14px"><dt class="muted">Placa</dt><dd class="mono" style="font-weight:600">{{ v.plate || '—' }}</dd></div>
        </dl>

        <h3 style="margin-top:24px;font-size:14px;font-weight:600">Referências de mercado</h3>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px;font-size:14px">
          <div style="display:flex;justify-content:space-between">
            <span class="muted">Tabela FIPE</span>
            <strong>{{ v.fipe_price ? (v.fipe_price | brl) : 'não encontrada' }}</strong>
          </div>
          @for (r of refs; track $index) {
            <div style="display:flex;justify-content:space-between;gap:12px">
              @if (r.url) { <a class="muted small" [href]="r.url" target="_blank" rel="noopener">{{ r.title }}</a> } @else { <span class="muted small">{{ r.title }}</span> }
              <span class="nowrap">{{ r.price | brl }}</span>
            </div>
          } @empty {
            <div class="muted small">Sem anúncios de referência.</div>
          }
          <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:10px;margin-top:4px">
            <span style="font-weight:600">Valor de mercado</span>
            <strong style="color:var(--primary);font-size:16px">{{ market_value ? (market_value | brl) : '—' }}</strong>
          </div>
        </div>
      } @else {
        <p class="muted" style="margin-top:16px">Consulte uma placa para ver os dados do veículo.</p>
      }
    </section>

    <!-- Coluna 2: Custos e margem -->
    <section class="panel" style="padding:24px;display:flex;flex-direction:column;gap:14px">
      <h2 style="font-size:18px;font-weight:600">Custos e margem</h2>
      <label><span class="muted">Margem desejada (%)</span><input type="number" step="0.5" class="field" style="margin-top:4px" [(ngModel)]="params.margem" (ngModelChange)="recalc()" /></label>
      <label><span class="muted">Preparação (R$)</span><input type="number" step="100" class="field" style="margin-top:4px" [(ngModel)]="params.preparacao" (ngModelChange)="recalc()" /></label>
      <label><span class="muted">Impostos (%)</span><input type="number" step="0.5" class="field" style="margin-top:4px" [(ngModel)]="params.impostos" (ngModelChange)="recalc()" /></label>
      <label><span class="muted">Comissão (%)</span><input type="number" step="0.5" class="field" style="margin-top:4px" [(ngModel)]="params.comissao" (ngModelChange)="recalc()" /></label>
      <label><span class="muted">Outros custos (R$)</span><input type="number" step="50" class="field" style="margin-top:4px" [(ngModel)]="params.outros" (ngModelChange)="recalc()" /></label>
    </section>

    <!-- Coluna 3: Resultado em destaque -->
    <section class="card hero" style="display:flex;flex-direction:column;justify-content:center;padding:32px;border-radius:calc(var(--radius) + 8px)">
      <p style="font-size:14px;opacity:0.85;margin:0">Preço máximo recomendado de compra</p>
      @if (market_value) {
        <p style="font-family:Sora,sans-serif;font-size:42px;font-weight:700;margin:12px 0 8px;letter-spacing:-.02em;line-height:1.1">{{ maxPrice | brl }}</p>
        <p style="font-size:14px;opacity:0.9;margin:0 0 16px">Lucro estimado na revenda: <strong>{{ estProfit | brl }}</strong></p>
        <p class="small" style="opacity:0.75;margin:0 0 24px">Total de custos previstos: {{ totalCosts | brl }}</p>
        <button class="btn" style="background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.4);width:100%;justify-content:center;font-weight:600" (click)="saveAppraisal()" [disabled]="busy">✓ Salvar avaliação</button>
      } @else {
        <p style="font-family:Sora,sans-serif;font-size:42px;font-weight:700;margin:12px 0 8px">—</p>
        <p class="small" style="opacity:0.85;margin:0">Sem FIPE ou anúncios de referência não há como calcular.</p>
      }
    </section>
  </div>

  <!-- Tabela de Histórico -->
  <div class="card mt" style="padding:0;margin-top:24px">
    <div class="card-head" style="padding:16px 20px;border-bottom:1px solid var(--border)"><h2>Histórico de avaliações</h2></div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Data</th><th>Veículo</th><th>Placa</th><th class="right">FIPE</th><th class="right">Mercado</th><th class="right">Máx. compra</th><th class="right">Lucro est.</th><th></th></tr>
        </thead>
        <tbody>
          @for (a of hist(); track a.id) {
            <tr>
              <td class="nowrap">{{ a.created_at | dateBR }}</td>
              <td><strong>{{ a.model }}</strong><div class="muted small">{{ a.year }} {{ a.color }}</div></td>
              <td class="mono">{{ a.plate || '—' }}</td>
              <td class="right nowrap">{{ a.fipe_price ? (a.fipe_price | brl) : '—' }}</td>
              <td class="right nowrap">{{ a.market_value | brl }}</td>
              <td class="right nowrap"><strong>{{ a.max_price | brl }}</strong></td>
              <td class="right nowrap up">{{ a.est_profit | brl }}</td>
              <td class="right nowrap">
                <button class="btn sm" (click)="loadHist(a)">Abrir</button>
                <button class="btn sm danger" (click)="remove(a)">Excluir</button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="8" class="empty">Nenhuma avaliação salva.</td></tr>
          }
        </tbody>
      </table>
    </div>
  </div>`,
})
export class AvaliacaoPage {
  private api = inject(Api);
  plate = '';
  busy = false;
  v: any = {};
  refs: Array<{ title: string; price: number; url?: string }> = [];
  params = PARAMS();
  market_value = 0;
  maxPrice = 0;
  estProfit = 0;
  totalCosts = 0;
  hist = signal<any[]>([]);

  ngOnInit() { this.loadHistory(); }

  async consultar() {
    const p = this.plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!p) return;
    this.busy = true;
    try {
      // Errors (invalid plate, API not configured, not found) are shown as toast; screen stays empty.
      const res: any = await this.api.act(() => this.api.get(`/appraisals/plate/${p}`));
      this.v = {}; this.refs = []; this.market_value = 0;
      if (!res?.model) return;
      this.v = {
        model: [res.brand, res.model, res.version].filter(Boolean).join(' '),
        year: res.year, color: res.color, plate: p, fipe_code: res.fipe_code, fipe_price: res.fipe_price || 0,
      };
      // Listings are optional: on failure the value falls back to FIPE.
      const m: any = await this.api.get('/appraisals/market', { q: [res.brand, res.model].filter(Boolean).join(' '), year: res.year }).catch(() => null);
      this.refs = m?.refs || [];
      this.market_value = this.avg();
    } finally {
      this.recalc();
      this.busy = false;
    }
  }

  // Market value = average of real listings, else FIPE, else nothing.
  private avg() {
    const prices = this.refs.map(r => Number(r.price)).filter(n => n > 0);
    return prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : Number(this.v.fipe_price) || 0;
  }

  recalc() {
    const m = this.market_value || 0;
    const pct = (x: number) => m * ((Number(x) || 0) / 100);
    const margem = pct(this.params.margem);
    const costs = pct(this.params.impostos) + pct(this.params.comissao) + Number(this.params.preparacao || 0) + Number(this.params.outros || 0);
    this.estProfit = Math.round(margem);
    this.totalCosts = Math.round(costs);
    this.maxPrice = Math.max(0, Math.round(m - margem - costs));
  }

  async saveAppraisal() {
    this.busy = true;
    const p = this.params;
    // Server recomputes with its own keys; map ours so the saved numbers match the screen (taxes are % of sale like commission).
    const params = { ...p, margin_pct: p.margem, commission_pct: Number(p.comissao || 0) + Number(p.impostos || 0), prep_cost: p.preparacao, docs_cost: 0, other_cost: p.outros };
    try {
      const r = await this.api.act(() => this.api.post('/appraisals', {
        plate: this.v.plate, model: this.v.model, year: this.v.year, color: this.v.color,
        fipe_code: this.v.fipe_code, fipe_price: this.v.fipe_price || null,
        market_refs: this.refs, market_value: this.market_value, params,
      }), 'Avaliação salva');
      if (r) await this.loadHistory();
    } finally { this.busy = false; }
  }

  async loadHistory() {
    const rows = await this.api.act(() => this.api.get<any[]>('/appraisals'));
    if (rows) this.hist.set(rows);
  }

  loadHist(a: any) {
    this.plate = a.plate || '';
    this.v = { model: a.model, year: a.year, color: a.color, plate: a.plate, fipe_code: a.fipe_code, fipe_price: Number(a.fipe_price) || 0 };
    this.refs = a.market_refs || [];
    this.market_value = Number(a.market_value) || 0;
    const p = a.params || {}, d = PARAMS();
    this.params = {
      margem: p.margem ?? p.margin_pct ?? d.margem,
      preparacao: p.preparacao ?? p.prep_cost ?? d.preparacao,
      impostos: p.impostos ?? 0,
      comissao: p.comissao ?? p.commission_pct ?? d.comissao,
      outros: p.outros ?? ((p.other_cost ?? 0) + (p.docs_cost ?? 0)),
    };
    this.recalc();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async remove(a: any) {
    if (!confirm(`Excluir avaliação de ${a.model}?`)) return;
    if (await this.api.act(() => this.api.del(`/appraisals/${a.id}`), 'Avaliação excluída')) this.hist.update(h => h.filter(x => x.id !== a.id));
  }
}
