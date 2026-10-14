import { Component, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Auth } from '../core';

@Component({
  selector: 'ap-login', standalone: true, imports: [FormsModule],
  template: `
  <div class="login-wrap">
    <form class="card login" (ngSubmit)="submit()">
      <div class="brand"><img class="logo" src="favicon.svg" alt="" /> AutoPainel</div>
      <h1>{{ signup ? 'Criar conta' : 'Entrar' }}</h1>
      <p class="muted" style="margin:0 0 16px">{{ signup ? 'Cadastre-se para acessar o painel.' : 'Acesse o painel da sua loja.' }}</p>
      @if (signup) { <label>Nome <input name="name" [(ngModel)]="name" required maxlength="120" autocomplete="name" /></label> }
      <label [class.mt]="signup">E-mail <input type="email" name="email" [(ngModel)]="email" required autocomplete="username" /></label>
      <label class="mt">Senha <input type="password" name="password" [(ngModel)]="password" required [attr.minlength]="signup ? 6 : null" [autocomplete]="signup ? 'new-password' : 'current-password'" /></label>
      @if (error) { <p class="down small" role="alert">{{ error }}</p> }
      <button class="btn primary mt" style="width:100%;justify-content:center" [disabled]="busy">{{ busy ? 'Aguarde…' : signup ? 'Criar conta' : 'Entrar' }}</button>
      @if (signupEnabled) {
        <p class="small muted mt" style="text-align:center">
          {{ signup ? 'Já tem conta?' : 'Não tem conta?' }}
          <button type="button" class="link" (click)="signup = !signup; error = ''">{{ signup ? 'Entrar' : 'Criar conta' }}</button>
        </p>
      }
    </form>
  </div>`,
})
export class LoginPage {
  private auth = inject(Auth);
  private router = inject(Router);
  name = ''; email = ''; password = ''; error = ''; busy = false;
  signup = false; signupEnabled = false;

  constructor() {
    firstValueFrom(inject(HttpClient).get<{ enabled: boolean }>('/api/auth/signup')).then(r => this.signupEnabled = r.enabled).catch(() => { });
  }

  async submit() {
    this.busy = true; this.error = '';
    try {
      await (this.signup ? this.auth.register(this.name, this.email, this.password) : this.auth.login(this.email, this.password));
      this.router.navigate(['/']);
    }
    catch (e: any) { this.error = e?.error?.error || (e?.status === 0 ? 'Sem conexão com a API' : 'Falha'); }
    finally { this.busy = false; }
  }
}
