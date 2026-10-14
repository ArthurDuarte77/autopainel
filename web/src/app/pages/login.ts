import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth } from '../core';

@Component({
  selector: 'ap-login', standalone: true, imports: [FormsModule],
  template: `
  <div class="login-wrap">
    <form class="card login" (ngSubmit)="submit()">
      <div class="brand"><span class="logo">A</span> AutoPainel</div>
      <h1>Entrar</h1>
      <p class="muted" style="margin:0 0 16px">Acesse o painel da sua loja.</p>
      <label>E-mail <input type="email" name="email" [(ngModel)]="email" required autocomplete="username" /></label>
      <label class="mt">Senha <input type="password" name="password" [(ngModel)]="password" required autocomplete="current-password" /></label>
      @if (error) { <p class="down small" role="alert">{{ error }}</p> }
      <button class="btn primary mt" style="width:100%;justify-content:center" [disabled]="busy">{{ busy ? 'Entrando…' : 'Entrar' }}</button>
    </form>
  </div>`,
})
export class LoginPage {
  private auth = inject(Auth);
  private router = inject(Router);
  email = ''; password = ''; error = ''; busy = false;

  async ngOnInit() {
    this.busy = true; this.error = '';
    try { await this.auth.login("admin@autopainel.local", "admin123"); this.router.navigate(['/']); }
    catch (e: any) { this.error = e?.error?.error || (e?.status === 0 ? 'Sem conexão com a API' : 'Falha no login'); }
    finally { this.busy = false; }
  }

  async submit() {
    this.busy = true; this.error = '';
    try { await this.auth.login(this.email, this.password); this.router.navigate(['/']); }
    catch (e: any) { this.error = e?.error?.error || (e?.status === 0 ? 'Sem conexão com a API' : 'Falha no login'); }
    finally { this.busy = false; }
  }
}
