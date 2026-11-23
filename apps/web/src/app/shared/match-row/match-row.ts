import { Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { MatchCard, initials } from '../../core/models/scene.models';

/**
 * Uma linha de partida, estilo HLTV: data | time A | placar | time B | torneio/fase.
 *   <app-match-row [match]="m" />
 *   <app-match-row [match]="m" [showTournament]="false" />   (dentro da página do torneio)
 */
@Component({
  selector: 'app-match-row',
  imports: [DatePipe, RouterLink],
  templateUrl: './match-row.html',
  styleUrl: './match-row.scss',
})
export class MatchRow {
  readonly match = input.required<MatchCard>();
  readonly showTournament = input(true);
  /** Destaca um time (página do time): vitória/derrota do ponto de vista dele */
  readonly focus = input<string | null>(null);

  protected readonly initials = initials;

  protected readonly result = computed<'win' | 'loss' | null>(() => {
    const m = this.match();
    const f = this.focus();
    if (!f || !m.winner) return null;
    const mine = m.team1.slug === f ? 1 : m.team2.slug === f ? 2 : null;
    return mine === null ? null : mine === m.winner ? 'win' : 'loss';
  });
}
