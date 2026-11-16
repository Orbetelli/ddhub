import { Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';

import { LiveService } from '../../core/services/live.service';

/**
 * Bloco "Ao vivo agora".
 *   <app-live-now />                    → grade com miniaturas (Criadores)
 *   <app-live-now variant="compact" />  → lista enxuta (home)
 */
@Component({
  selector: 'app-live-now',
  imports: [DatePipe],
  templateUrl: './live-now.html',
  styleUrl: './live-now.scss',
})
export class LiveNow {
  readonly variant = input<'full' | 'compact'>('full');
  readonly limit = input<number>(12);

  protected readonly live = inject(LiveService);

  protected readonly streams = computed(() => this.live.snapshot().streams.slice(0, this.limit()));
  protected readonly total = computed(() => this.live.snapshot().streams.length);

  protected viewers(n: number): string {
    return n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : String(n);
  }
}
