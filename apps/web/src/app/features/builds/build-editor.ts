import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, firstValueFrom, map, of } from 'rxjs';

import { BuildPhase, BuildsService, PHASE_LABEL, PHASES } from '../../core/services/builds.service';
import { AuthService } from '../../core/services/auth.service';
import { HeroesService } from '../../core/services/heroes.service';
import { ItemsService } from '../../core/services/items.service';
import { NamePreferenceService } from '../../core/services/name-preference.service';
import { apiError } from '../../core/services/account.service';
import { ItemSlot, ShopItem } from '../../core/models/item.models';

interface Picked {
  slug: string;
  phase: BuildPhase;
  note: string;
}

const MAX_ITEMS = 40;
const SLOT_LABEL: Record<ItemSlot, string> = { weapon: 'Arma', vitality: 'Vitalidade', spirit: 'Espiritual' };

/** /builds/nova (?heroi=) e /builds/:id/editar */
@Component({
  selector: 'app-build-editor',
  imports: [DecimalPipe, RouterLink],
  templateUrl: './build-editor.html',
  styleUrls: ['./builds.scss', './build-editor.scss'],
})
export class BuildEditor {
  protected readonly auth = inject(AuthService);
  private readonly builds = inject(BuildsService);
  private readonly router = inject(Router);
  protected readonly names = inject(NamePreferenceService);

  /** /builds/:id/editar */
  readonly id = input<string | undefined>();
  /** /builds/nova?heroi=haze */
  readonly heroi = input<string | undefined>();

  protected readonly phases = PHASES;
  protected readonly phaseLabel = PHASE_LABEL;
  protected readonly slotLabel = SLOT_LABEL;
  protected readonly slots: ItemSlot[] = ['weapon', 'vitality', 'spirit'];
  protected readonly maxItems = MAX_ITEMS;

  protected readonly heroes = toSignal(
    inject(HeroesService)
      .list()
      .pipe(
        map((hs) => [...hs].sort((a, b) => this.names.primary(a.name, a.name_en).localeCompare(this.names.primary(b.name, b.name_en), 'pt-BR'))),
        catchError(() => of([])),
      ),
    { initialValue: [] },
  );
  private readonly shop = toSignal(inject(ItemsService).list().pipe(catchError(() => of([] as ShopItem[]))), { initialValue: [] as ShopItem[] });
  private readonly bySlug = computed(() => new Map(this.shop().map((i) => [i.slug, i])));

  // Formulário
  protected readonly hero = signal('');
  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly items = signal<Picked[]>([]);
  protected readonly published = signal(false);
  protected readonly activePhase = signal<BuildPhase>('early');

  // Loja
  protected readonly query = signal('');
  protected readonly slot = signal<ItemSlot | null>(null);
  protected readonly tier = signal<number | null>(null);

  protected readonly loading = signal(false);
  protected readonly notFound = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  private loadedId: string | null = null;

  protected readonly isEdit = computed(() => !!this.id());
  protected readonly used = computed(() => new Set(this.items().map((i) => i.slug)));

  protected readonly filteredShop = computed(() => {
    const q = norm(this.query());
    const s = this.slot();
    const t = this.tier();
    return this.shop()
      .filter((i) => (!s || i.slot === s) && (!t || i.tier === t))
      .filter((i) => !q || norm(i.name).includes(q) || norm(i.name_en ?? '').includes(q))
      .sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || (a.slot ?? '').localeCompare(b.slot ?? '') || a.name.localeCompare(b.name, 'pt-BR'));
  });

  protected readonly grouped = computed(() =>
    PHASES.map((phase) => {
      const list = this.items()
        .map((p, index) => ({ ...p, index, info: this.bySlug().get(p.slug) }))
        .filter((p) => p.phase === phase);
      return { phase, list, cost: list.reduce((s, p) => s + (p.info?.cost ?? 0), 0) };
    }),
  );

  protected readonly canSave = computed(() => !!this.hero() && this.title().trim().length >= 3 && !this.saving());

  constructor() {
    // Editar: carrega a build uma vez, quando souber o id
    effect(() => {
      const id = this.id();
      if (!id || id === this.loadedId) return;
      this.loadedId = id;
      void this.load(id);
    });
    // Nova: herói sugerido pela URL
    effect(() => {
      const h = this.heroi();
      if (!this.id() && h && !this.hero()) this.hero.set(h);
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const b = await firstValueFrom(this.builds.get(id));
      if (!b.can_edit) {
        this.notFound.set(true);
        return;
      }
      this.hero.set(b.hero?.slug ?? '');
      this.title.set(b.title);
      this.description.set(b.description ?? '');
      this.published.set(b.published);
      this.items.set(b.phases.flatMap((p) => p.items.map((i) => ({ slug: i.slug, phase: p.phase, note: i.note ?? '' }))));
    } catch {
      this.notFound.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected add(item: ShopItem): void {
    if (this.used().has(item.slug) || this.items().length >= MAX_ITEMS) return;
    this.items.update((list) => [...list, { slug: item.slug, phase: this.activePhase(), note: '' }]);
  }

  protected removeAt(index: number): void {
    this.items.update((list) => list.filter((_, i) => i !== index));
  }

  /** Sobe/desce dentro da mesma fase. */
  protected move(index: number, dir: -1 | 1): void {
    this.items.update((list) => {
      const phase = list[index].phase;
      let j = index + dir;
      while (j >= 0 && j < list.length && list[j].phase !== phase) j += dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  protected setPhase(index: number, phase: BuildPhase): void {
    this.items.update((list) => {
      const next = [...list];
      const [moved] = next.splice(index, 1);
      next.push({ ...moved, phase });
      return next;
    });
  }

  protected setNote(index: number, note: string): void {
    this.items.update((list) => list.map((p, i) => (i === index ? { ...p, note: note.slice(0, 120) } : p)));
  }

  protected async save(publish: boolean): Promise<void> {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.error.set(null);
    const input = {
      hero: this.hero(),
      title: this.title(),
      description: this.description(),
      published: publish,
      items: this.items().map((p) => ({ item: p.slug, phase: p.phase, note: p.note.trim() || undefined })),
    };
    try {
      const id = this.id();
      const res = id ? await this.builds.update(id, input) : await this.builds.create(input);
      await this.router.navigate(['/builds', res.id]);
    } catch (err) {
      this.error.set(apiError(err, 'Não deu para salvar. Tente de novo.'));
    } finally {
      this.saving.set(false);
    }
  }
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
