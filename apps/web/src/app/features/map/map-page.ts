import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';

import { MapService } from '../../core/services/map.service';
import { KIND_INFO, LANE_LABEL, MapData, MapMarker, MarkerKind, TEAM_LABEL } from '../../core/models/map.models';

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: MapData };

/** Ordem das camadas na legenda (da lane até a base, depois o neutro). */
const KIND_ORDER: MarkerKind[] = ['guardiao', 'andador', 'guardiao-base', 'santuario', 'base', 'patrono', 'chefe-meio', 'acampamento', 'outro'];

const SIZE_LABEL = { pequeno: 'pequeno', medio: 'médio', grande: 'grande', cofre: '(cofre)' } as const;

@Component({
  selector: 'app-map-page',
  imports: [RouterLink],
  templateUrl: './map-page.html',
  styleUrl: './map-page.scss',
})
export class MapPage {
  protected readonly info = KIND_INFO;

  protected readonly state = toSignal(
    inject(MapService)
      .get()
      .pipe(
        map((data): LoadState => ({ status: 'ok', data })),
        catchError(() => of<LoadState>({ status: 'error' })),
        startWith<LoadState>({ status: 'loading' }),
      ),
    { requireSync: true },
  );

  protected readonly data = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.data : null;
  });

  /** Camadas escondidas pelo usuário (todas aparecem por padrão). */
  protected readonly hidden = signal<ReadonlySet<MarkerKind>>(new Set());
  /** 'mapa' = superfície com marcadores; senão, a chave de uma imagem de túneis. */
  protected readonly view = signal<string>('mapa');
  protected readonly selectedId = signal<string | null>(null);

  /** Camadas que existem nos dados, com contagem. */
  protected readonly layers = computed(() => {
    const markers = this.data()?.markers ?? [];
    return KIND_ORDER.map((kind) => ({ kind, label: KIND_INFO[kind].label, count: markers.filter((m) => m.kind === kind).length })).filter(
      (l) => l.count > 0,
    );
  });

  protected readonly visible = computed(() => {
    if (this.view() !== 'mapa') return [];
    const hidden = this.hidden();
    return (this.data()?.markers ?? []).filter((m) => !hidden.has(m.kind));
  });

  protected readonly viewImage = computed(() => {
    const d = this.data();
    if (!d) return null;
    return this.view() === 'mapa' ? d.image : (d.views.find((v) => v.key === this.view())?.url ?? d.image);
  });

  protected readonly selected = computed(() => this.data()?.markers.find((m) => m.id === this.selectedId()) ?? null);

  protected toggleLayer(kind: MarkerKind): void {
    const next = new Set(this.hidden());
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    this.hidden.set(next);
    if (this.selected()?.kind === kind) this.selectedId.set(null);
  }

  protected select(m: MapMarker): void {
    this.selectedId.set(this.selectedId() === m.id ? null : m.id);
  }

  protected title(m: MapMarker): string {
    const base = KIND_INFO[m.kind].label;
    if (m.kind === 'acampamento' && m.size) return `${base} ${SIZE_LABEL[m.size]}`;
    return base;
  }

  protected laneLabel(m: MapMarker): string | null {
    return m.lane === null ? null : (LANE_LABEL[m.lane] ?? `Lane ${m.lane}`);
  }

  protected teamLabel(m: MapMarker): string | null {
    return m.team === null ? null : TEAM_LABEL[m.team];
  }

  protected markerClass(m: MapMarker): string {
    const team = m.team === null ? 'neutral' : `t${m.team}`;
    return `marker marker--${m.kind} marker--${team}${m.size ? ' marker--' + m.size : ''}${m.id === this.selectedId() ? ' is-selected' : ''}`;
  }

  protected ariaLabel(m: MapMarker): string {
    return [this.title(m), this.laneLabel(m), this.teamLabel(m)].filter(Boolean).join(' · ');
  }
}