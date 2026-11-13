import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';

import { CreatorsService } from '../../core/services/creators.service';
import { Creator, PlatformLink, platformLinks } from '../../core/models/creator.models';
import { Markdown } from '../../shared/markdown/markdown';

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; creators: Creator[] };

interface CreatorView extends Creator {
  links: PlatformLink[];
  initials: string;
}

@Component({
  selector: 'app-creator-list',
  imports: [Markdown],
  templateUrl: './creator-list.html',
  styleUrl: './creator-list.scss',
})
export class CreatorList {
  protected readonly state = toSignal(
    inject(CreatorsService)
      .list()
      .pipe(
        map((creators): LoadState => ({ status: 'ok', creators })),
        catchError(() => of<LoadState>({ status: 'error' })),
        startWith<LoadState>({ status: 'loading' }),
      ),
    { requireSync: true },
  );

  protected readonly tag = signal<string | null>(null);

  private readonly all = computed<CreatorView[]>(() => {
    const s = this.state();
    if (s.status !== 'ok') return [];
    return s.creators.map((c) => ({
      ...c,
      links: platformLinks(c),
      initials: c.name
        .split(/\s+/)
        .map((w: string) => w[0] ?? '')
        .join('')
        .slice(0, 2)
        .toUpperCase(),
    }));
  });

  /** Tags usadas por pelo menos um criador, para o filtro. */
  protected readonly tags = computed(() => [...new Set(this.all().flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b, 'pt-BR')));

  protected readonly stats = computed(() => {
    const all = this.all();
    return {
      total: all.length,
      twitch: all.filter((c) => c.twitch).length,
      youtube: all.filter((c) => c.youtube).length,
    };
  });

  /** Cartões fantasmas do estado vazio. */
  protected readonly ghosts = [1, 2, 3];

  protected readonly creators = computed(() => {
    const t = this.tag();
    return t ? this.all().filter((c) => c.tags.includes(t)) : this.all();
  });
}