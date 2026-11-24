import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import { AccountData, AccountService, apiError } from '../../core/services/account.service';
import { AuthService } from '../../core/services/auth.service';

/** /conta: editar perfil, contas ligadas, sessões, baixar dados e excluir conta (LGPD). */
@Component({
  selector: 'app-account-page',
  imports: [DatePipe, RouterLink],
  templateUrl: './account-page.html',
  styleUrl: './account-page.scss',
})
export class AccountPage {
  protected readonly auth = inject(AuthService);
  private readonly accounts = inject(AccountService);
  private readonly router = inject(Router);

  protected readonly data = signal<AccountData | null>(null);
  protected readonly loadError = signal(false);

  // Formulário do perfil
  protected readonly displayName = signal('');
  protected readonly username = signal('');
  protected readonly bio = signal('');
  protected readonly saving = signal(false);
  protected readonly saveMsg = signal<{ ok: boolean; text: string } | null>(null);

  // Zona de perigo
  protected readonly confirmText = signal('');
  protected readonly busy = signal(false);
  protected readonly dangerMsg = signal<string | null>(null);

  protected readonly dirty = computed(() => {
    const u = this.data()?.user;
    return !!u && (this.displayName() !== u.display_name || this.username() !== u.username || this.bio() !== (u.bio ?? ''));
  });
  protected readonly canDelete = computed(() => {
    const u = this.data()?.user;
    return !!u && this.confirmText().trim().replace(/^@/, '').toLowerCase() === u.username.toLowerCase();
  });
  protected readonly steam = computed(() => this.data()?.identities.find((i) => i.provider === 'steam') ?? null);

  constructor() {
    // Carrega quando souber que tem alguém logado
    effect(() => {
      if (this.auth.user() && !this.data()) void this.load();
    });
  }

  protected loginUrl(): string {
    return this.auth.steamLoginUrl('/conta');
  }

  private async load(): Promise<void> {
    try {
      const d = await this.accounts.account();
      this.data.set(d);
      this.displayName.set(d.user.display_name);
      this.username.set(d.user.username);
      this.bio.set(d.user.bio ?? '');
    } catch {
      this.loadError.set(true);
    }
  }

  protected async save(): Promise<void> {
    const u = this.data()?.user;
    if (!u || this.saving()) return;
    this.saving.set(true);
    this.saveMsg.set(null);
    try {
      await this.accounts.update({ display_name: this.displayName(), username: this.username(), bio: this.bio() });
      this.data.set(null);
      await this.load();
      this.saveMsg.set({ ok: true, text: 'Perfil salvo.' });
    } catch (err) {
      this.saveMsg.set({ ok: false, text: apiError(err) });
    } finally {
      this.saving.set(false);
    }
  }

  protected reset(): void {
    const u = this.data()?.user;
    if (!u) return;
    this.displayName.set(u.display_name);
    this.username.set(u.username);
    this.bio.set(u.bio ?? '');
    this.saveMsg.set(null);
  }

  /** "Baixar meus dados" (LGPD): o mesmo JSON que a API guarda sobre você. */
  protected download(): void {
    const d = this.data();
    if (!d) return;
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ddhub-meus-dados-${d.user.username}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  protected async logoutAll(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.accounts.logoutAll();
      await this.router.navigateByUrl('/');
    } catch (err) {
      this.dangerMsg.set(apiError(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    if (!this.canDelete() || this.busy()) return;
    this.busy.set(true);
    this.dangerMsg.set(null);
    try {
      await this.accounts.remove(this.confirmText());
      await this.router.navigateByUrl('/?login=excluida');
    } catch (err) {
      this.dangerMsg.set(apiError(err));
    } finally {
      this.busy.set(false);
    }
  }
}
