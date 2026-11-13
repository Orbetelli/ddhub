import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';

import { ItemsService } from '../../../core/services/items.service';
import { NamePreferenceService } from '../../../core/services/name-preference.service';
import { ItemSlot, SLOT_LABEL, ShopItem } from '../../../core/models/item.models';

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; items: ShopItem[] };

interface TierColumn {
  tier: number;
  cost: number | null;
  items: ShopItem[];
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

@Component({
  selector: 'app-item-list',
  imports: [RouterLink],
  templateUrl: './item-list.html',
  styleUrl: './item-list.scss',
})
export class ItemList {
  protected readonly names = inject(NamePreferenceService);
  protected readonly slotOptions = Object.entries(SLOT_LABEL) as [ItemSlot, string][];

  protected readonly state = toSignal(
    inject(ItemsService)
      .list()
      .pipe(
        map((items): LoadState => ({ status: 'ok', items })),
        catchError(() => of<LoadState>({ status: 'error' })),
        startWith<LoadState>({ status: 'loading' }),
      ),
    { requireSync: true },
  );

  protected readonly slot = signal<ItemSlot>('weapon');
  protected readonly search = signal('');
  protected readonly onlyActive = signal(false);

  /** Com busca digitada, procura nas três categorias; sem busca, mostra a aba escolhida. */
  protected readonly searching = computed(() => this.search().trim().length > 0);

  protected readonly visible = computed(() => {
    const s = this.state();
    if (s.status !== 'ok') return [];
    const q = norm(this.search().trim());
    return s.items
      .filter((i) => (q ? norm(i.name).includes(q) || norm(i.name_en ?? '').includes(q) : i.slot === this.slot()))
      .filter((i) => !this.onlyActive() || i.is_active_item);
  });

  /** Colunas por tier, como na loja do jogo. O custo do cabeçalho vem dos próprios itens. */
  protected readonly columns = computed<TierColumn[]>(() => {
    const byTier = new Map<number, ShopItem[]>();
    for (const item of this.visible()) {
      const t = item.tier ?? 0;
      byTier.set(t, [...(byTier.get(t) ?? []), item]);
    }
    return [...byTier.entries()]
      .sort(([a], [b]) => a - b)
      .map(([tier, items]) => ({
        tier,
        items,
        cost: items.reduce<number | null>((min, i) => (i.cost !== null && (min === null || i.cost < min) ? i.cost : min), null),
      }));
  });

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected clear(): void {
    this.search.set('');
    this.onlyActive.set(false);
  }
}