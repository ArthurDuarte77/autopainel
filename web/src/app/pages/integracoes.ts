import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api, Auth, BrlPipe, Toast } from '../core';

const SELLER = () => ({ name: '', email: '', phone: '', commission_pct: 1, monthly_goal: null, active: 1 } as any);
const when = (d: string) => (d ? `${d.slice(0, 10).split('-').reverse().join('/')} ${d.slice(11, 16)}` : '');

@Component({
  selector: 'ap-integracoes', standalone: true, imports: [FormsModule, BrlPipe],
  template: `
  <div class="page-head">
    <div><h1>Integrações</h1><p class="muted">Credenciais ficam no arquivo <code>.env</code>. Após editar, reinicie a API (<code>docker compose restart api</code>).</p></div>
    <div class="actions"><button class="btn" (click)="load()">Atualizar</button></div>
  </div>

  <div class="tabs" role="tablist">
    @for (t of tabs; track t) { <button role="tab" [class.active]="tab === t" (click)="setTab(t)">{{ t }}</button> }
  </div>

  @if (data(); as d) {
    @if (tab === 'Canais') {
      <div class="grid g3 mt">
        @for (c of d.channels; track c.id) {
          <div class="card">
            <div class="card-head" style="margin-bottom:6px"><h3>{{ c.name }}</h3><span class="badge" [class]="'badge ' + state(c)[1]">{{ state(c)[0] }}</span></div>
            <div class="small muted">{{ c.kind === 'marketplace' ? 'Marketplace' : 'E-commerce / site' }}@if (c.connected_at) { · conectado em {{ when(c.connected_at) }} }</div>
            <div class="small mt"><span class="muted">.env:</span> @for (k of c.env; track k) { <code class="small">{{ k }}</code> }</div>
            @if (c.last_log; as l) { <div class="small mt" [class.down]="!l.ok" style="margin-top:6px">{{ l.action }} · {{ when(l.created_at) }}@if (l.message) { — {{ l.message }} }</div> }
            <div class="actions mt" style="margin-top:10px">
              @if (c.oauth) {
                @if (c.connected) { <button class="btn sm danger" (click)="disconnect(c)" [disabled]="busy">Desconectar</button> }
                @else { <button class="btn sm primary" (click)="connect(c)" [disabled]="busy || !c.configured">Conectar</button> }
              }
              @if (c.id === 'mercadolivre' && c.connected) { <button class="btn sm" (click)="mlQuestions()" [disabled]="busy">Importar perguntas</button> }
            </div>
          </div>
        }
      </div>
    }

    @if (tab === 'CRMs') {
      <div class="grid g3 mt">
        @for (c of d.crms; track c.id) {
          <div class="card">
            <div class="card-head" style="margin-bottom:6px"><h3>{{ c.name }}</h3><span class="badge" [class]="'badge ' + (c.configured ? 'green' : '')">{{ c.configured ? 'Configurado' : 'Não configurado' }}</span></div>
            <div class="small muted">{{ c.pull ? 'Envia e importa leads' : 'Somente envio de leads' }}</div>
            <div class="small mt"><span class="muted">.env:</span> @for (k of c.env; track k) { <code class="small">{{ k }}</code> }</div>
            @if (c.last_log; as l) { <div class="small mt" [class.down]="!l.ok" style="margin-top:6px">{{ l.action }} · {{ when(l.created_at) }}@if (l.message) { — {{ l.message }} }</div> }
            <div class="actions mt" style="margin-top:10px">
              @if (c.pull) { <button class="btn sm" (click)="pull(c)" [disabled]="busy || !c.configured">Importar leads</button> }
              <button class="btn sm" (click)="pushAll(c)" [disabled]="busy || !c.configured">Enviar todos os leads</button>
            </div>
          </div>
        }
      </div>
      <p class="muted small mt">Leads novos e alterados são enviados automaticamente a todos os CRMs configurados.</p>
    }

    @if (tab === 'Serviços') {
      <div class="grid g2 mt">
        @for (s of d.services; track s.id) {
          <div class="card">
            <div class="card-head" style="margin-bottom:6px"><h3>{{ s.name }}</h3><span class="badge" [class]="'badge ' + (s.configured ? 'green' : '')">{{ s.configured ? 'Ativo' : 'Não configurado' }}</span></div>
            @if (s.note) { <div class="small muted">{{ s.note }}</div> }
            <div class="small mt"><span class="muted">.env:</span> @for (k of s.env; track k) { <code class="small">{{ k }}</code> }</div>
            @if (s.last_log; as l) { <div class="small mt" [class.down]="!l.ok" style="margin-top:6px">{{ l.action }} · {{ when(l.created_at) }}@if (l.message) { — {{ l.message }} }</div> }
          </div>
        }
      </div>
    }

    @if (tab === 'Webhooks') {
      <div class="card mt">
        <p class="muted small" style="margin-top:0">Cadastre estas URLs nos painéis de cada serviço. Em produção, defina <code>PUBLIC_URL</code> no .env com seu domínio HTTPS.</p>
        @for (w of hooks(d.webhooks); track w[0]) {
          <div class="kv"><span>{{ w[1] }}</span>
            <span style="display:flex;gap:8px;align-items:center;min-width:0"><code class="small" style="overflow:hidden;text-overflow:ellipsis">{{ d.webhooks[w[0]] }}</code>
              <button class="btn sm" (click)="copy(d.webhooks[w[0]])">Copiar</button></span></div>
        }
        <h3 class="mt">Formulário do site próprio</h3>
        <p class="small muted">POST JSON em <code>{{ d.webhooks.site_leads }}</code> com <code>{{ '{' }}"name","phone","email","message","vehicle_id"{{ '}' }}</code>. Opcional: header <code>X-AutoPainel-Signature</code> = HMAC-SHA256 do corpo com <code>SITE_WEBHOOK_SECRET</code>.</p>
      </div>
    }

    @if (tab === 'Logs') {
      <div class="filters mt">
        <select [(ngModel)]="logProvider" (change)="loadLogs()" aria-label="Integração">
          <option value="">Todas integrações</option>
          @for (p of providers(d); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
        </select>
      </div>
      <div class="card" style="padding:0">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Integração</th><th>Ação</th><th>Status</th><th>Mensagem</th></tr></thead>
            <tbody>
              @for (l of logs(); track l.id) {
                <tr>
                  <td class="nowrap">{{ when(l.created_at) }}</td>
                  <td>{{ l.provider }}</td>
                  <td>{{ l.action }}</td>
                  <td><span class="badge" [class]="'badge ' + (l.ok ? 'green' : 'red')">{{ l.ok ? 'OK' : 'Erro' }}</span></td>
                  <td class="small" style="white-space:normal;max-width:480px">{{ l.message }}</td>
                </tr>
              } @empty { <tr><td colspan="5" class="empty">Nenhum registro.</td></tr> }
            </tbody>
          </table>
        </div>
      </div>
    }

    @if (tab === 'Configurações') {
      <div class="grid g2-1 mt">
        <div class="card" style="padding:0">
          <div class="card-head" style="padding:16px 16px 0"><h2>Vendedores</h2><button class="btn sm primary" (click)="seller = SELLER()">+ Vendedor</button></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Nome</th><th>Contato</th><th class="right">Comissão</th><th class="right">Meta mensal</th><th></th></tr></thead>
              <tbody>
                @for (s of sellers(); track s.id) {
                  <tr [style.opacity]="s.active ? 1 : .5">
                    <td><strong>{{ s.name }}</strong>@if (!s.active) { <span class="badge">inativo</span> }</td>
                    <td class="small">{{ s.email }}<div class="muted">{{ s.phone }}</div></td>
                    <td class="right">{{ s.commission_pct }}%</td>
                    <td class="right nowrap">{{ s.monthly_goal | brl }}</td>
                    <td class="right"><button class="btn sm" (click)="editSeller(s)">Editar</button></td>
                  </tr>
                } @empty { <tr><td colspan="5" class="empty">Nenhum vendedor.</td></tr> }
              </tbody>
            </table>
          </div>
        </div>

        <div>
          @if (admin) {
            <form class="card" (ngSubmit)="saveGoal()">
              <div class="card-head"><h2>Meta da loja</h2></div>
              <label>Meta de faturamento mensal (R$) <input type="number" step="0.01" name="goal" [(ngModel)]="goal" /></label>
              <button class="btn primary mt" [disabled]="busy">Salvar meta</button>
            </form>
          }
          <form class="card mt" (ngSubmit)="changePassword()">
            <div class="card-head"><h2>Alterar senha</h2></div>
            <div style="display:grid;gap:10px">
              <label>Senha atual <input type="password" name="current" [(ngModel)]="pw.current" autocomplete="current-password" required /></label>
              <label>Nova senha <input type="password" name="password" [(ngModel)]="pw.password" minlength="6" autocomplete="new-password" required /></label>
              <label>Confirmar <input type="password" name="confirm" [(ngModel)]="pw.confirm" autocomplete="new-password" required /></label>
            </div>
            <button class="btn primary mt" [disabled]="busy || !pw.password || pw.password !== pw.confirm">Alterar senha</button>
          </form>
        </div>
      </div>
    }
  } @else { <div class="empty">Carregando…</div> }

  @if (seller) {
    <div class="modal-bg" (click)="seller = null">
      <form class="modal sm" (click)="$event.stopPropagation()" (ngSubmit)="saveSeller()" role="dialog" aria-modal="true">
        <div class="modal-head"><h2>{{ seller.id ? 'Editar vendedor' : 'Novo vendedor' }}</h2><button type="button" class="icon-btn" (click)="seller = null" aria-label="Fechar">✕</button></div>
        <div class="modal-body" style="display:grid;gap:12px">
          <label>Nome* <input name="name" [(ngModel)]="seller.name" required /></label>
          <label>E-mail <input type="email" name="email" [(ngModel)]="seller.email" /></label>
          <label>Telefone <input name="phone" [(ngModel)]="seller.phone" /></label>
          <label>Comissão (%) <input type="number" step="0.01" name="commission_pct" [(ngModel)]="seller.commission_pct" /></label>
          <label>Meta mensal (R$) <input type="number" step="0.01" name="monthly_goal" [(ngModel)]="seller.monthly_goal" /></label>
          <label class="check"><input type="checkbox" name="active" [(ngModel)]="seller.active" /> Ativo</label>
        </div>
        <div class="modal-foot">
          @if (seller.id && seller.active) { <button type="button" class="btn danger" (click)="deactivate()">Desativar</button> }
          <span class="spacer"></span>
          <button type="button" class="btn" (click)="seller = null">Cancelar</button>
          <button class="btn primary" [disabled]="busy">Salvar</button>
        </div>
      </form>
    </div>
  }`,
})
export class IntegracoesPage {
  private api = inject(Api);
  private toast = inject(Toast);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  SELLER = SELLER; when = when;
  tabs = ['Canais', 'CRMs', 'Serviços', 'Webhooks', 'Logs', 'Configurações'];
  tab = 'Canais';
  admin = inject(Auth).user()?.role === 'admin';
  data = signal<any>(null);
  logs = signal<any[]>([]);
  sellers = signal<any[]>([]);
  logProvider = ''; goal: any = null; seller: any = null; busy = false;
  pw: any = { current: '', password: '', confirm: '' };

  constructor() {
    const qp = this.route.snapshot.queryParamMap;
    if (qp.get('connected')) this.toast.show(`${qp.get('connected')} conectado com sucesso`);
    if (qp.get('error')) this.toast.show(qp.get('error')!, true);
    if (qp.get('tab') && this.tabs.includes(qp.get('tab')!)) this.tab = qp.get('tab')!;
    if (qp.keys.length) this.router.navigate([], { queryParams: {}, replaceUrl: true });
    this.load();
    this.setTab(this.tab);
  }

  async load() { const d = await this.api.act(() => this.api.get('/integrations')); if (d) this.data.set(d); }
  setTab(t: string) {
    this.tab = t;
    if (t === 'Logs') this.loadLogs();
    if (t === 'Configurações') {
      this.loadSellers();
      this.api.get('/settings').then(s => this.goal = s.monthly_revenue_goal ?? null).catch(() => {});
    }
  }
  state(c: any): [string, string] {
    if (!c.configured) return ['Não configurado', ''];
    if (c.oauth && !c.connected) return ['Desconectado', 'yellow'];
    return ['Conectado', 'green'];
  }
  hooks(w: any) {
    const names: Record<string, string> = { mercadolivre: 'Mercado Livre (notificações)', olx: 'OLX (leads)', whatsapp: 'WhatsApp Cloud API', site_leads: 'Leads do site próprio', feed: 'Feed XML do estoque' };
    return Object.keys(w).map(k => [k, names[k] || k]);
  }
  providers(d: any) { return [...d.channels, ...d.crms, ...d.services]; }

  private async run<T>(fn: () => Promise<T>, ok?: any) { this.busy = true; try { return await this.api.act(fn, ok); } finally { this.busy = false; } }

  async connect(c: any) { const r = await this.run(() => this.api.get(`/integrations/${c.id}/connect`)); if (r?.url) window.location.href = r.url; }
  async disconnect(c: any) {
    if (!confirm(`Desconectar ${c.name}? Os anúncios publicados não serão removidos.`)) return;
    if (await this.run(() => this.api.del(`/integrations/${c.id}/token`), `${c.name} desconectado`)) this.load();
  }
  async mlQuestions() { await this.run(() => this.api.post('/integrations/mercadolivre/questions'), (r: any) => `${r.created} novos leads de ${r.total} perguntas`); this.load(); }
  async pull(c: any) { await this.run(() => this.api.post(`/integrations/crm/${c.id}/pull`), (r: any) => `${c.name}: ${r.created} novos leads de ${r.total}`); this.load(); }
  async pushAll(c: any) {
    if (!confirm(`Enviar todos os leads abertos para ${c.name}?`)) return;
    await this.run(() => this.api.post(`/integrations/crm/${c.id}/push-all`),
      (r: any) => `${c.name}: ${r.ok}/${r.total} enviados${r.errors.length ? ' · ' + r.errors[0] : ''}`);
    this.load();
  }
  async loadLogs() {
    const r = await this.api.act(() => this.api.get('/integrations/logs', { provider: this.logProvider, limit: 200 }));
    if (r) this.logs.set(r);
  }
  copy(text: string) { navigator.clipboard?.writeText(text).then(() => this.toast.show('Copiado'), () => this.toast.show('Não foi possível copiar', true)); }

  editSeller(s: any) { this.seller = { ...s }; }
  async loadSellers() { const s = await this.api.act(() => this.api.get('/sellers')); if (s) this.sellers.set(s); }
  async saveSeller() {
    const s = { ...this.seller, active: this.seller.active ? 1 : 0 };
    const r = await this.run(() => s.id ? this.api.put(`/sellers/${s.id}`, s) : this.api.post('/sellers', s), 'Vendedor salvo');
    if (r) { this.seller = null; this.loadSellers(); }
  }
  async deactivate() {
    if (!confirm(`Desativar ${this.seller.name}?`)) return;
    if (await this.run(() => this.api.del(`/sellers/${this.seller.id}`), 'Vendedor desativado')) { this.seller = null; this.loadSellers(); }
  }
  saveGoal() { this.run(() => this.api.put('/settings', { monthly_revenue_goal: this.goal }), 'Meta salva'); }
  async changePassword() {
    if (this.pw.password !== this.pw.confirm) return this.toast.show('As senhas não conferem', true);
    if (await this.run(() => this.api.post('/auth/password', { current: this.pw.current, password: this.pw.password }), 'Senha alterada'))
      this.pw = { current: '', password: '', confirm: '' };
  }
}
