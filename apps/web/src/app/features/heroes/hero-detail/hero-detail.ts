import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Markdown } from '../../../shared/markdown/markdown';
import { HttpErrorResponse } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { HeroesService } from '../../../core/services/heroes.service';
import { NamePreferenceService } from '../../../core/services/name-preference.service';
import {
  AbilityItem,
  COMPLEXITY_LABEL,
  HERO_TYPE_LABEL,
  HeroDetail as HeroData,
  PopularItem,
} from '../../../core/models/hero.models';

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ok'; hero: HeroData };

type Tab = 'overview' | 'guide' | 'abilities' | 'items' | 'lore';

interface StatView {
  label: string;
  value: string;
}

/** Stats iniciais exibidos na visão geral (chave da API → rótulo). */
const STAT_LABELS: [key: string, label: string, suffix?: string][] = [
  ['max_health', 'Vida'],
  ['base_health_regen', 'Regeneração de vida', '/s'],
  ['max_move_speed', 'Velocidade', ' m/s'],
  ['sprint_speed', 'Bônus de corrida', ' m/s'],
  ['stamina', 'Vigor'],
  ['light_melee_damage', 'Corpo a corpo leve'],
  ['heavy_melee_damage', 'Corpo a corpo pesado'],
];

/** Propriedades de habilidade mostradas como "chips" (recarga, duração...). */
const ABILITY_KEY_PROPS = ['AbilityCooldown', 'AbilityDuration', 'AbilityCastRange', 'Radius', 'AbilityCharges'];

/** Remove HTML e marcadores do jogo ({g:...}, {s:...}) das descrições. */
function plainText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

@Component({
  selector: 'app-hero-detail',
  imports: [RouterLink, Markdown],
  templateUrl: './hero-detail.html',
  styleUrl: './hero-detail.scss',
})
export class HeroDetail {
  /** Vem do parâmetro da rota /herois/:slug (withComponentInputBinding). */
  readonly slug = input.required<string>();

  protected readonly names = inject(NamePreferenceService);
  protected readonly typeLabel = HERO_TYPE_LABEL;
  protected readonly complexityLabel = COMPLEXITY_LABEL;
  private readonly heroes = inject(HeroesService);

  protected readonly tab = signal<Tab>('overview');
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Visão geral' },
    { id: 'guide', label: 'Como jogar' },
    { id: 'abilities', label: 'Habilidades' },
    { id: 'items', label: 'Itens populares' },
    { id: 'lore', label: 'História' },
  ];

  protected readonly state = toSignal(
    toObservable(this.slug).pipe(
      switchMap((slug) =>
        this.heroes.get(slug).pipe(
          map((hero): LoadState => ({ status: 'ok', hero })),
          catchError((err: HttpErrorResponse) =>
            of<LoadState>({ status: err.status === 404 || err.status === 400 ? 'not-found' : 'error' }),
          ),
          startWith<LoadState>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as LoadState },
  );

  protected readonly hero = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.hero : null;
  });

  protected readonly stats = computed<StatView[]>(() => {
    const h = this.hero();
    if (!h) return [];
    return STAT_LABELS.filter(([key]) => typeof h.starting_stats[key] === 'number').map(([key, label, suffix]) => ({
      label,
      value: `${h.starting_stats[key]}${suffix ?? ''}`,
    }));
  });

  protected readonly abilities = computed(() =>
    (this.hero()?.hero_abilities ?? [])
      .filter((a): a is { slot: number; items: AbilityItem } => !!a.items)
      .map((a) => ({
        slot: a.slot,
        item: a.items,
        text: this.abilityText(a.items),
        keyProps: this.keyProps(a.items),
        upgrades: this.upgradeLines(a.items),
      })),
  );

  /** Seções do guia "Como jogar" que têm texto, na ordem da partida. */
  protected readonly guideSections = computed(() => {
    const g = this.hero()?.guide;
    if (!g) return [];
    return [
      { id: 'lane', title: 'Fase de lane', md: g.lane_md },
      { id: 'early', title: 'Início de jogo', md: g.early_md },
      { id: 'mid', title: 'Meio de jogo', md: g.mid_md },
      { id: 'late', title: 'Fim de jogo', md: g.late_md },
      { id: 'combos', title: 'Combos', md: g.combos_md },
    ].filter((s): s is { id: string; title: string; md: string } => !!s.md?.trim());
  });

  protected readonly popularPhases = computed(() => {
    const p = this.hero()?.popular;
    if (!p) return [];
    return [
      { label: 'Início de jogo', items: p.early },
      { label: 'Meio de jogo', items: p.mid },
      { label: 'Fim de jogo', items: p.late },
    ].filter((phase) => phase.items.length > 0);
  });

  protected scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected slotClass(item: PopularItem): string {
    return item.slot ? `slot--${item.slot}` : '';
  }

  private abilityText(item: AbilityItem): string {
    const d = item.description ?? {};
    return plainText(d['desc']) || plainText(Object.values(d).find((v) => typeof v === 'string'));
  }

  private keyProps(item: AbilityItem): string[] {
    const props = item.properties ?? {};
    return ABILITY_KEY_PROPS.map((k) => props[k])
      .filter((p) => p?.label && p.value !== undefined && Number(p.value) > 0)
      .map((p) => `${p!.label}: ${p!.value}${p!.postfix ?? ''}`.trim());
  }

  /** Cada nível de melhoria → frases tipo "+20% Roubo de vida espiritual". */
  private upgradeLines(item: AbilityItem): string[][] {
    const props = item.properties ?? {};
    return (item.upgrades ?? []).map((tier) =>
      (tier.property_upgrades ?? []).map((u) => {
        const prop = props[u.name];
        const bonus = String(u.bonus);
        const sign = bonus.startsWith('-') ? '' : '+';
        const label = prop?.label ?? u.name;
        return `${sign}${bonus}${prop?.postfix ?? ''} ${label}`.trim();
      }),
    );
  }
}