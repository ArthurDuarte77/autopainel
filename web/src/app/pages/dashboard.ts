import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, BrlPipe, MONTHS, thisMonth, thousands } from '../core';
import { Icon } from '../app';

@Component({
  selector: 'ap-dashboard', standalone: true, imports: [FormsModule, RouterLink, BrlPipe, Icon],
  template: `
  @if (d(); as d) {
    <div class="page-head">
      <div><h1>{{ greeting }}, {{ first(d.user?.name) }}</h1><p class="muted">Aqui está o resumo da sua loja hoje.</p></div>
      <div class="actions"><input type="month" [(ngModel)]="month" (change)="load()" aria-label="Mês" /></div>
    </div>

    <div class="grid g4">
      <div class="card hero">
        <div class="stat-label">Faturamento no mês</div>
        <div class="stat-value">{{ d.revenue.value | brl }}</div>
        <div class="progress" style="background:rgba(255,255,255,0.25)"><span [style.width.%]="min(d.revenue.pct, 100)" style="background:#fff"></span></div>
        <div class="small mt" style="margin-top:6px;opacity:.85">Meta: {{ k(d.revenue.goal) }} ({{ d.revenue.pct }}%)</div>
      </div>
      <div class="card">
        <div class="stat-label">Veículos disponíveis</div>
        <div class="stat-value">{{ d.stock.available }}</div>
        <div class="small muted">{{ d.stock.count }} no total</div>
      </div>
      <div class="card">
        <div class="stat-label">Valor em estoque</div>
        <div class="stat-value">{{ d.stock.value | brl }}</div>
        <div class="small muted">Preço de venda anunciado</div>
      </div>
      <div class="card">
        <div class="stat-label">Lucro médio por veículo</div>
        <div class="stat-value">{{ d.avg_profit.value | brl }}</div>
        <div class="small" [class.up]="d.avg_profit.delta_pct >= 0" [class.down]="d.avg_profit.delta_pct < 0">
          {{ d.avg_profit.delta_pct >= 0 ? '+' : '' }}{{ d.avg_profit.delta_pct }}% vs. {{ prevMonth }}
        </div>
      </div>
    </div>

    <div class="grid g2-1 mt">
      <div class="card">
        <div class="card-head"><h2>Faturamento (R$ mil)</h2><span class="muted small">Últimos 6 meses</span></div>
        <div class="bars">
          @for (b of d.chart; track b.month; let last = $last) {
            <div class="bar" [class.current]="last">
              <span class="v">{{ round(b.value / 1000) }}</span>
              <div class="col" [style.height.%]="max ? (b.value / max) * 85 : 0"></div>
              <span class="m">{{ short(b.month) }}</span>
            </div>
          }
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Metas por vendedor</h2></div>
        @for (s of d.sellers; track s.id) {
          <div style="margin-bottom:14px">
            <div class="kv" style="border:0;padding:0 0 6px"><strong>{{ s.name }}</strong><span class="muted small">{{ s.revenue | brl }} / {{ s.monthly_goal | brl }} · {{ s.sold }} vendas</span></div>
            <div class="progress"><span [style.width.%]="min(s.pct, 100)"></span></div>
          </div>
        } @empty { <div class="empty">Nenhum vendedor cadastrado.</div> }
      </div>
    </div>

    <div class="grid g2-1 mt">
      <div class="card">
        <div class="card-head">
          <div>
            <div style="display:flex;align-items:center;gap:6px">
              <ap-icon name="sparkles" [size]="18" style="color:var(--primary)" />
              <h2>Oportunidades recuperadas</h2>
            </div>
            <p class="muted small" style="margin:2px 0 0">Clientes cujo veículo procurado chegou ao estoque.</p>
          </div>
          <a routerLink="/crm">Ver CRM →</a>
        </div>
        <div class="list">
          @for (o of d.opportunities; track o.lead.id) {
            <div class="list-item">
              <div style="flex:1;min-width:0">
                <strong>{{ o.lead.name }}</strong> <span class="badge">{{ o.lead.stage }}</span>
                <div class="muted small">Procurava: {{ o.lead.interest }}</div>
              </div>
              <div class="right">
                @for (v of o.vehicles.slice(0, 2); track v.id) { <div class="badge green">Chegou: {{ v.label }} · {{ v.price | brl }}</div> }
              </div>
            </div>
          } @empty { <div class="empty">Nenhuma oportunidade no momento.</div> }
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Agenda de hoje</h2><a routerLink="/agenda">Ver agenda →</a></div>
        <div class="list">
          @for (e of d.today_events; track e.id) {
            <div class="list-item">
              <span class="mono">{{ e.time?.slice(0, 5) }}</span>
              <div style="flex:1"><div [style.text-decoration]="e.done ? 'line-through' : ''">{{ e.title }}</div><span class="muted small">{{ e.category }}</span></div>
            </div>
          } @empty { <div class="empty">Nada agendado para hoje.</div> }
        </div>
      </div>
    </div>
  } @else { <div class="empty">Carregando…</div> }`,
})
export class DashboardPage {
  private api = inject(Api);
  d = signal<any>(null);
  month = thisMonth();
  min = Math.min; round = Math.round; k = thousands;
  // Getter so a tab left open since morning updates; store clock, not the device's timezone.
  get greeting() {
    const h = +new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(new Date());
    return h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
  }

  constructor() { this.load(); }
  async load() { const d = await this.api.act(() => this.api.get('/dashboard', { month: this.month })); if (d) this.d.set(d); }
  get max() { return Math.max(...(this.d()?.chart || []).map((b: any) => Number(b.value)), 0); }
  get prevMonth() { const m = Number(this.month.slice(5, 7)); return MONTHS[(m + 10) % 12].toLowerCase(); }
  first(n?: string) { return (n || '').split(' ')[0]; }
  short(ym: string) { return MONTHS[Number(ym.slice(5, 7)) - 1].slice(0, 3); }
}
