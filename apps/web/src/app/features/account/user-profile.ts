import { Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { AccountService, PublicProfile } from '../../core/services/account.service';
import { BuildCard as Build, BuildsService } from '../../core/services/builds.service';
import { BuildCard } from '../../shared/build-card/build-card';
import { AuthService } from '../../core/services/auth.service';

type State = { status: 'loading' } | { status: 'missing' } | { status: 'ok'; profile: PublicProfile };

/** Perfil público: /u/<@> */
@Component({
  selector: 'app-user-profile',
  imports: [DatePipe, RouterLink, BuildCard],
  template: `
    <section class="profile">
      @switch (state().status) {
        @case ('loading') {
          <p class="muted">Carregando perfil…</p>
        }
        @case ('missing') {
          <h1>Perfil não encontrado</h1>
          <p class="muted">Esse &#64; não existe ou a conta foi excluída.</p>
          <a routerLink="/">Voltar para o início</a>
        }
        @case ('ok') {
          @let p = profile()!;
          <header class="card">
            @if (p.avatar_url) {
              <img class="avatar" [src]="p.avatar_url" alt="" width="112" height="112" />
            } @else {
              <span class="avatar avatar--empty" aria-hidden="true">{{ p.display_name.charAt(0) }}</span>
            }
            <div class="who">
              <h1>
                {{ p.display_name }}
                @if (p.staff) {
                  <span class="staff">Equipe DDhub</span>
                }
              </h1>
              <p class="handle">&#64;{{ p.username }}</p>
              <p class="since">No DDhub desde {{ p.created_at | date: "MMMM 'de' y" }}</p>
              @if (p.bio) {
                <p class="bio">{{ p.bio }}</p>
              }
            </div>
            @if (isMe()) {
              <a class="edit" routerLink="/conta">Editar perfil</a>
            }
          </header>
          <section class="builds">
            <h2>Builds</h2>
            @if (builds() === null) {
              <p class="muted">Carregando…</p>
            } @else if (!builds()!.length) {
              <p class="muted">
                Nenhuma build publicada ainda.
                @if (isMe()) {
                  <a routerLink="/builds/nova">Criar a primeira →</a>
                }
              </p>
            } @else {
              <div class="grid">
                @for (b of builds(); track b.id) {
                  <app-build-card [build]="b" [showAuthor]="false" />
                }
              </div>
            }
          </section>
        }
      }
    </section>
  `,
  styles: `
    .profile { max-width: 860px; margin: 0 auto; padding: 32px 16px 48px; display: flex; flex-direction: column; gap: 16px; }
    .card { display: flex; gap: 20px; align-items: flex-start; padding: 24px; background: var(--surface); border: 1px solid var(--border); position: relative; }
    @media (max-width: 560px) { .card { flex-direction: column; } }
    .avatar { width: 112px; height: 112px; border-radius: 4px; object-fit: cover; flex: none; border: 2px solid var(--accent); }
    .avatar--empty { display: grid; place-items: center; background: var(--surface-sub); color: var(--accent); font-size: 48px; font-weight: 700; text-transform: uppercase; }
    .who { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    h1 { margin: 0; font-family: var(--font-display); color: var(--text-strong); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; overflow-wrap: anywhere; }
    .staff { font-family: var(--font-cond); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; padding: 3px 8px; background: var(--accent); color: var(--bg); }
    .handle { margin: 0; color: var(--accent); font-weight: 600; }
    .since { margin: 0; color: var(--muted); font-size: 14px; }
    .bio { margin: 8px 0 0; white-space: pre-line; color: var(--text); overflow-wrap: anywhere; }
    .edit { position: absolute; top: 20px; right: 20px; font-size: 14px; }
    @media (max-width: 560px) { .edit { position: static; } }
    .muted { color: var(--muted); }
    .builds h2 { margin: 8px 0 10px; font-family: var(--font-cond); font-size: 18px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-strong); }
    .builds .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  `,
})
export class UserProfile {
  private readonly accounts = inject(AccountService);
  private readonly buildsApi = inject(BuildsService);
  private readonly auth = inject(AuthService);

  /** Vem da rota /u/:username */
  readonly username = input.required<string>();

  protected readonly state = toSignal(
    toObservable(this.username).pipe(
      switchMap((u) =>
        this.accounts.profile(u).pipe(
          map((profile): State => ({ status: 'ok', profile })),
          catchError(() => of<State>({ status: 'missing' })),
          startWith<State>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as State },
  );

  /** Builds publicadas da pessoa (null = carregando) */
  protected readonly builds = toSignal(
    toObservable(this.username).pipe(
      switchMap((u) =>
        this.buildsApi.byUser(u).pipe(
          map((r): Build[] | null => r.builds),
          catchError(() => of<Build[] | null>([])),
          startWith<Build[] | null>(null),
        ),
      ),
    ),
    { initialValue: null },
  );

  protected readonly profile = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.profile : null;
  });

  protected readonly isMe = computed(() => {
    const me = this.auth.user();
    const p = this.profile();
    return !!me && !!p && me.username.toLowerCase() === p.username.toLowerCase();
  });
}
