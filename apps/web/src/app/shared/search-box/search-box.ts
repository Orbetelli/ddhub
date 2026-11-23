import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';

import { SEARCH_TYPE_LABEL, SearchResult, SearchService } from '../../core/services/search.service';

type SearchState = { status: 'idle' } | { status: 'loading' } | { status: 'done'; q: string; results: SearchResult[] };

/**
 * Caixa de busca do topo: resultados aparecem enquanto digita (heróis, itens, times,
 * jogadores, criadores, torneios, notícias e capítulos do Aprender).
 * Teclado: ↑ ↓ escolhem, Enter abre, Esc fecha. Atalho "/" foca a busca.
 */
@Component({
  selector: 'app-search-box',
  template: `
    <div class="box">
      <label for="busca" class="sr-only">Buscar no DDhub</label>
      <input
        id="busca"
        class="input"
        type="search"
        placeholder="Buscar…  /"
        autocomplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="busca-lista"
        [attr.aria-expanded]="open()"
        [attr.aria-activedescendant]="active() >= 0 ? 'busca-op-' + active() : null"
        [value]="query()"
        (input)="onInput($event)"
        (focus)="open.set(query().trim().length >= 2)"
        (keydown)="onKey($event)"
      />
      @if (open()) {
        <div class="panel">
          @switch (state().status) {
            @case ('loading') { <p class="hint">Buscando…</p> }
            @case ('done') {
              @if (results().length) {
                <ul id="busca-lista" class="list" role="listbox" aria-label="Resultados da busca">
                  @for (r of results(); track r.url + r.label; let i = $index) {
                    <li
                      [id]="'busca-op-' + i"
                      class="opt"
                      role="option"
                      [class.opt--active]="i === active()"
                      [attr.aria-selected]="i === active()"
                      (mousedown)="$event.preventDefault()"
                      (click)="go(r)"
                      (mouseenter)="active.set(i)"
                    >
                      @if (r.image) {
                        <img class="opt__img" [src]="r.image" alt="" width="32" height="32" loading="lazy" />
                      } @else {
                        <span class="opt__img opt__img--empty" aria-hidden="true">{{ typeLabel[r.type].charAt(0) }}</span>
                      }
                      <span class="opt__text">
                        <span class="opt__label">{{ r.label }}</span>
                        <span class="opt__sub">{{ r.sub || typeLabel[r.type] }}</span>
                      </span>
                      <span class="opt__type">{{ typeLabel[r.type] }}</span>
                    </li>
                  }
                </ul>
              } @else {
                <p class="hint">Nada encontrado para "{{ query().trim() }}".</p>
              }
            }
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; position: relative; }
    .box { position: relative; }
    .input {
      width: 200px;
      height: 36px;
      padding: 0 10px;
      border-radius: 2px;
      border: 1px solid #2c2c2c;
      background: var(--bg);
      color: var(--text);
      font: inherit;
      &:focus { outline: none; border-color: var(--accent); }
    }
    .panel {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      z-index: 45;
      width: min(420px, 92vw);
      max-height: 70vh;
      overflow-y: auto;
      background: #161616;
      border: 1px solid #2c2c2c;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
    }
    .hint { margin: 0; padding: 14px; font-size: 14px; color: var(--muted); }
    .list { margin: 0; padding: 4px; list-style: none; }
    .opt {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 48px;
      padding: 6px 8px;
      cursor: pointer;
      &--active { background: #232323; }
    }
    .opt__img { flex: none; width: 32px; height: 32px; object-fit: cover; background: #0f0f0f; }
    .opt__img--empty { display: grid; place-items: center; font-family: var(--font-display); font-weight: 900; color: var(--accent); }
    .opt__text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .opt__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; color: var(--text-strong); }
    .opt__sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--faint); }
    .opt__type {
      flex: none;
      font-family: var(--font-cond);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--accent);
    }
    @media (max-width: 900px) {
      :host { flex: 1 1 auto; }
      .input { width: 100%; }
      .panel { left: 0; right: auto; width: 100%; }
    }
  `,
})
export class SearchBox {
  private readonly searchService = inject(SearchService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly typeLabel = SEARCH_TYPE_LABEL;
  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(-1);

  protected readonly state = toSignal(
    toObservable(this.query).pipe(
      map((q) => q.trim()),
      debounceTime(180),
      distinctUntilChanged(),
      switchMap((q) =>
        q.length < 2
          ? of<SearchState>({ status: 'idle' })
          : this.searchService.search(q).pipe(
              map((results): SearchState => ({ status: 'done', q, results })),
              startWith<SearchState>({ status: 'loading' }),
            ),
      ),
    ),
    { initialValue: { status: 'idle' } as SearchState },
  );

  protected results(): SearchResult[] {
    const s = this.state();
    return s.status === 'done' ? s.results : [];
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
    this.active.set(-1);
    this.open.set(value.trim().length >= 2);
  }

  protected onKey(event: KeyboardEvent): void {
    const list = this.results();
    if (event.key === 'ArrowDown' && list.length) {
      event.preventDefault();
      this.open.set(true);
      this.active.update((i) => (i + 1) % list.length);
    } else if (event.key === 'ArrowUp' && list.length) {
      event.preventDefault();
      this.active.update((i) => (i <= 0 ? list.length - 1 : i - 1));
    } else if (event.key === 'Enter') {
      const pick = list[this.active()] ?? list[0];
      if (pick) {
        event.preventDefault();
        this.go(pick);
      }
    } else if (event.key === 'Escape') {
      this.open.set(false);
      this.active.set(-1);
    }
  }

  protected go(r: SearchResult): void {
    this.open.set(false);
    this.active.set(-1);
    this.query.set('');
    (this.host.nativeElement.querySelector('input') as HTMLInputElement | null)?.blur();
    void this.router.navigateByUrl(r.url);
  }

  @HostListener('document:click', ['$event'])
  protected onDocClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  /** Atalho "/" foca a busca (quando não está digitando em outro campo). */
  @HostListener('document:keydown', ['$event'])
  protected onShortcut(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      (this.host.nativeElement.querySelector('input') as HTMLInputElement | null)?.focus();
    }
  }
}
