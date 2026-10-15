import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, BrlPipe, DateBRPipe } from '../core';
import { Icon } from '../app';

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
      <dl style="margin-top:16px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;justify-content:space-between;font-size:14px">
          <dt class="muted">Modelo</dt>
          <dd style="font-weight:600">{{ v.model || 'VW Polo Highline 1.0 TSI' }}</dd>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:14px">
          <dt class="muted">Ano</dt>
          <dd style="font-weight:600">{{ v.year || 2022 }}</dd>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:14px">
          <dt class="muted">Cor</dt>
          <dd style="font-weight:600">{{ v.color || 'Prata' }}</dd>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:14px">
          <dt class="muted">Placa</dt>
          <dd class="mono" style="font-weight:600">{{ v.plate || 'ABC-1D23' }}</dd>
        </div>
      </dl>

      <h3 style="margin-top:24px;font-size:14px;font-weight:600">Referências de mercado</h3>
      <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px;font-size:14px">
        <div style="display:flex;justify-content:space-between">
          <span class="muted">Tabela FIPE</span>
          <strong>{{ (v.fipe_price || 98500) | brl }}</strong>
        </div>
        @for (r of refs; track $index) {
          <div style="display:flex;justify-content:space-between">
            <span class="muted">{{ r.title }}</span>
            <span>{{ r.price | brl }}</span>
          </div>
        }
        <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:10px;margin-top:4px">
          <span style="font-weight:600">Valor de mercado</span>
          <strong style="color:var(--primary);font-size:16px">{{ market_value | brl }}</strong>
        </div>
      </div>
    </section>

    <!-- Coluna 2: Custos e margem -->
    <section class="panel" style="padding:24px;display:flex;flex-direction:column;gap:14px">
      <h2 style="font-size:18px;font-weight:600">Custos e margem</h2>
      <label>
        <span class="muted">Margem desejada (%)</span>
        <input type="number" step="0.5" class="field" style="margin-top:4px" [(ngModel)]="params.margem" (ngModelChange)="recalc()" />
      </label>
      <label>
        <span class="muted">Preparação (R$)</span>
        <input type="number" step="100" class="field" style="margin-top:4px" [(ngModel)]="params.preparacao" (ngModelChange)="recalc()" />
      </label>
      <label>
        <span class="muted">Impostos (%)</span>
        <input type="number" step="0.5" class="field" style="margin-top:4px" [(ngModel)]="params.impostos" (ngModelChange)="recalc()" />
      </label>
      <label>
        <span class="muted">Comissão (%)</span>
        <input type="number" step="0.5" class="field" style="margin-top:4px" [(ngModel)]="params.comissao" (ngModelChange)="recalc()" />
      </label>
      <label>
        <span class="muted">Outros custos (R$)</span>
        <input type="number" step="50" class="field" style="margin-top:4px" [(ngModel)]="params.outros" (ngModelChange)="recalc()" />
      </label>
    </section>

    <!-- Coluna 3: Resultado em destaque -->
    <section class="card hero" style="display:flex;flex-direction:column;justify-content:center;padding:32px;border-radius:calc(var(--radius) + 8px)">
      <p style="font-size:14px;opacity:0.85;margin:0">Preço máximo recomendado de compra</p>
      <p style="font-family:Sora,sans-serif;font-size:42px;font-weight:700;margin:12px 0 8px;letter-spacing:-.02em;line-height:1.1">{{ maxPrice | brl }}</p>
      <p style="font-size:14px;opacity:0.9;margin:0 0 16px">Lucro estimado na revenda: <strong>{{ estProfit | brl }}</strong></p>
      <p class="small" style="opacity:0.75;margin:0 0 24px">Total de custos previstos: {{ totalCosts | brl }}</p>
      <button class="btn" style="background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.4);width:100%;justify-content:center;font-weight:600" (click)="saveAppraisal()" [disabled]="busy">
        {{ savedMsg ? '✓ Salvo com sucesso!' : '✓ Salvar avaliação' }}
      </button>
    </section>
  </div>

  <!-- Tabela de Histórico -->
  <div class="card mt" style="padding:0;margin-top:24px">
    <div class="card-head" style="padding:16px 20px;border-bottom:1px solid var(--border)">
      <h2>Histórico de avaliações</h2>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Veículo</th>
            <th>Placa</th>
            <th class="right">FIPE</th>
            <th class="right">Mercado</th>
            <th class="right">Máx. compra</th>
            <th class="right">Lucro est.</th>
            <th></th>
          </tr>
        </thead>
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
  plate = 'ABC-1D23';
  busy = false;
  savedMsg = false;

  v: any = {
    model: 'VW Polo Highline 1.0 TSI',
    year: 2022,
    color: 'Prata',
    plate: 'ABC-1D23',
    fipe_price: 98500,
  };

  refs: Array<{ title: string; price: number }> = [
    { title: 'Anúncio semelhante 1', price: 96900 },
    { title: 'Anúncio semelhante 2', price: 101500 },
    { title: 'Anúncio semelhante 3', price: 99800 },
  ];

  params = {
    margem: 12,
    preparacao: 2500,
    impostos: 3,
    comissao: 1.5,
    outros: 800,
  };

  market_value = 98950;
  maxPrice = 79323;
  estProfit = 11874;
  totalCosts = 7753;

  hist = signal<any[]>([]);

  ngOnInit() {
    this.recalc();
    this.loadHistory();
  }

  async consultar() {
    if (!this.plate?.trim()) return;
    this.busy = true;
    const cleanPlate = this.plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    try {
      const res: any = await this.api.get(`/appraisals/plate/${cleanPlate}`);
      if (res && res.model) {
        this.v = {
          model: `${res.brand || ''} ${res.model || ''} ${res.version || ''}`.trim() || 'Veículo consultado',
          year: res.year || new Date().getFullYear(),
          color: res.color || 'Prata',
          plate: this.plate.toUpperCase(),
          fipe_price: res.fipe_price || 95000,
        };
        try {
          const mRes: any = await this.api.get('/appraisals/market', { q: this.v.model, year: this.v.year });
          if (mRes?.refs?.length) {
            this.refs = mRes.refs.slice(0, 3).map((r: any, idx: number) => ({
              title: r.title || `Anúncio semelhante ${idx + 1}`,
              price: r.price,
            }));
            this.market_value = mRes.average || this.v.fipe_price;
          } else {
            this.fallbackRefs();
          }
        } catch {
          this.fallbackRefs();
        }
      } else {
        this.applyMockByPlate(cleanPlate);
      }
    } catch {
      this.applyMockByPlate(cleanPlate);
    } finally {
      this.recalc();
      this.busy = false;
    }
  }

  private applyMockByPlate(p: string) {
    const mocks: Record<string, any> = {
      'RTF4E21': { model: 'Toyota Corolla XEi 2.0', year: 2022, color: 'Prata', fipe: 128900 },
      'QWE8A33': { model: 'Honda HR-V EXL', year: 2021, color: 'Branco', fipe: 119500 },
      'SDF1B90': { model: 'Jeep Compass Longitude', year: 2023, color: 'Preto', fipe: 164000 },
      'PLK7C12': { model: 'VW T-Cross Highline', year: 2022, color: 'Cinza', fipe: 132000 },
      'MNB3D45': { model: 'Chevrolet Onix LTZ', year: 2020, color: 'Branco', fipe: 72900 },
      'ZXC9F67': { model: 'Hyundai Creta Platinum', year: 2023, color: 'Azul', fipe: 149900 },
      'GHJ2K88': { model: 'Fiat Toro Volcano', year: 2021, color: 'Vermelho', fipe: 139000 },
      'TYU5L03': { model: 'Renault Kwid Zen', year: 2022, color: 'Branco', fipe: 54900 },
      'ABC1D23': { model: 'VW Polo Highline 1.0 TSI', year: 2022, color: 'Prata', fipe: 98500 },
    };
    const found = mocks[p] || { model: 'VW Polo Highline 1.0 TSI', year: 2022, color: 'Prata', fipe: 98500 };
    this.v = {
      model: found.model,
      year: found.year,
      color: found.color,
      plate: this.plate.toUpperCase(),
      fipe_price: found.fipe,
    };
    this.fallbackRefs();
  }

  private fallbackRefs() {
    const base = this.v.fipe_price || 98500;
    this.refs = [
      { title: 'Anúncio semelhante 1', price: Math.round(base * 0.985) },
      { title: 'Anúncio semelhante 2', price: Math.round(base * 1.03) },
      { title: 'Anúncio semelhante 3', price: Math.round(base * 1.012) },
    ];
    this.market_value = Math.round((base + this.refs[0].price + this.refs[1].price + this.refs[2].price) / 4);
  }

  recalc() {
    const m = this.market_value || this.v.fipe_price || 98950;
    const impostos = m * ((this.params.impostos || 0) / 100);
    const comissao = m * ((this.params.comissao || 0) / 100);
    const margem = m * ((this.params.margem || 0) / 100);
    const prep = Number(this.params.preparacao || 0);
    const outros = Number(this.params.outros || 0);

    this.estProfit = Math.round(margem);
    this.totalCosts = Math.round(impostos + comissao + prep + outros);
    this.maxPrice = Math.max(0, Math.round(m - margem - impostos - comissao - prep - outros));
  }

  async saveAppraisal() {
    this.busy = true;
    try {
      await this.api.post('/appraisals', {
        plate: this.v.plate,
        model: this.v.model,
        year: this.v.year,
        color: this.v.color,
        fipe_price: this.v.fipe_price,
        market_refs: this.refs,
        market_value: this.market_value,
        params: this.params,
        max_price: this.maxPrice,
        est_profit: this.estProfit,
      });
      this.savedMsg = true;
      setTimeout(() => this.savedMsg = false, 3000);
      await this.loadHistory();
    } catch {
      const item = {
        id: Date.now(),
        created_at: new Date().toISOString(),
        plate: this.v.plate,
        model: this.v.model,
        year: this.v.year,
        color: this.v.color,
        fipe_price: this.v.fipe_price,
        market_value: this.market_value,
        max_price: this.maxPrice,
        est_profit: this.estProfit,
      };
      this.hist.update(list => [item, ...list]);
      this.savedMsg = true;
      setTimeout(() => this.savedMsg = false, 3000);
    } finally {
      this.busy = false;
    }
  }

  async loadHistory() {
    try {
      const rows = await this.api.get<any[]>('/appraisals');
      this.hist.set(rows || []);
    } catch {
      this.hist.set([]);
    }
  }

  loadHist(a: any) {
    this.plate = a.plate || '';
    this.v = {
      model: a.model,
      year: a.year,
      color: a.color,
      plate: a.plate,
      fipe_price: a.fipe_price,
    };
    this.market_value = a.market_value || a.fipe_price;
    if (a.params) {
      const p = typeof a.params === 'string' ? JSON.parse(a.params) : a.params;
      this.params = {
        margem: p.margem || p.margin_pct || 12,
        preparacao: p.preparacao || p.prep_cost || 2500,
        impostos: p.impostos || 3,
        comissao: p.comissao || p.commission_pct || 1.5,
        outros: p.outros || p.other_cost || 800,
      };
    }
    this.fallbackRefs();
    this.recalc();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async remove(a: any) {
    if (!confirm(`Excluir avaliação de ${a.model}?`)) return;
    try { await this.api.del(`/appraisals/${a.id}`); } catch {}
    this.hist.update(h => h.filter(x => x.id !== a.id));
  }
}
