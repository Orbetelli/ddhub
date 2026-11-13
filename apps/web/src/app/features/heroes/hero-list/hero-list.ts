import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';

import { HeroesService } from '../../../core/services/heroes.service';
import { NamePreferenceService } from '../../../core/services/name-preference.service';
import { COMPLEXITY_LABEL, HERO_TYPE_LABEL, HeroCard, HeroType } from '../../../core/models/hero.models';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ok'; heroes: HeroCard[] };

/** Tira acentos e caixa: "Bruma" e "bruma" e "brúma" batem igual. */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

@Component({
  selector: 'app-hero-list',
  imports: [RouterLink],
  templateUrl: './hero-list.html',
  styleUrl: './hero-list.scss',
})
export class HeroList {
  protected readonly names = inject(NamePreferenceService);
  protected readonly typeLabel = HERO_TYPE_LABEL;
  protected readonly complexityLabel = COMPLEXITY_LABEL;

  protected readonly typeOptions = Object.entries(HERO_TYPE_LABEL) as [HeroType, string][];
  protected readonly complexityOptions = [1, 2, 3];

  protected readonly state = toSignal(
    inject(HeroesService)
      .list()
      .pipe(
        map((heroes): LoadState => ({ status: 'ok', heroes })),
        catchError(() => of<LoadState>({ status: 'error' })),
        startWith<LoadState>({ status: 'loading' }),
      ),
    { requireSync: true },
  );

  protected readonly search = signal('');
  protected readonly type = signal<HeroType | 'all'>('all');
  protected readonly complexity = signal<number | 'all'>('all');

  protected readonly filtered = computed(() => {
    const s = this.state();
    if (s.status !== 'ok') return [];
    const q = norm(this.search().trim());
    const type = this.type();
    const complexity = this.complexity();

    return s.heroes
      .filter((h) => !q || norm(h.name).includes(q) || norm(h.name_en ?? '').includes(q))
      .filter((h) => type === 'all' || h.hero_type === type)
      .filter((h) => complexity === 'all' || h.complexity === complexity)
      .sort((a, b) =>
        this.names.primary(a.name, a.name_en).localeCompare(this.names.primary(b.name, b.name_en), 'pt-BR'),
      );
  });

  /** "Assassino · Fácil" — só inclui o que existir (evita "Místico ·" sobrando). */
  protected meta(h: HeroCard): string {
    return [
      h.hero_type ? this.typeLabel[h.hero_type] : null,
      h.complexity ? this.complexityLabel[h.complexity] : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.type.set('all');
    this.complexity.set('all');
  }
}