import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

import { PortalDataService } from '../../core/services/portal-data.service';
import { ARTICLE_CATEGORY_LABEL, Article, Match } from '../../core/models/portal.models';
import { Panel } from '../../shared/panel/panel';
import { LiveNow } from '../../shared/live-now/live-now';

interface MatchGroup {
  key: 'live' | 'upcoming' | 'results';
  label: string;
  matches: Match[];
}

interface ArticleDay {
  label: string;
  articles: Article[];
}

@Component({
  selector: 'app-home',
  imports: [Panel, RouterLink, DatePipe, LiveNow],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly data = inject(PortalDataService);

  protected readonly categoryLabel = ARTICLE_CATEGORY_LABEL;

  protected readonly matches = toSignal(this.data.getMatches(), { initialValue: [] });
  protected readonly tournaments = toSignal(this.data.getTournaments(), { initialValue: [] });
  protected readonly articles = toSignal(this.data.getLatestArticles(), { initialValue: [] });
  protected readonly transfers = toSignal(this.data.getRecentTransfers(), { initialValue: [] });
  protected readonly topics = toSignal(this.data.getHotTopics(), { initialValue: [] });
  protected readonly heroes = toSignal(this.data.getTopHeroes(), { initialValue: [] });
  protected readonly builds = toSignal(this.data.getTopBuilds(), { initialValue: [] });

  /** Partidas agrupadas como na HLTV: ao vivo → próximas → resultados. */
  protected readonly matchGroups = computed<MatchGroup[]>(() => {
    const all = this.matches();
    const byDate = (a: Match, b: Match) => a.scheduledAt.localeCompare(b.scheduledAt);
    const groups: MatchGroup[] = [
      { key: 'live', label: 'Ao vivo', matches: all.filter((m) => m.status === 'live') },
      { key: 'upcoming', label: 'Próximas', matches: all.filter((m) => m.status === 'scheduled').sort(byDate) },
      { key: 'results', label: 'Resultados', matches: all.filter((m) => m.status === 'finished').sort(byDate).reverse() },
    ];
    return groups.filter((g) => g.matches.length > 0);
  });

  /** Matéria em destaque = a mais recente; as duas seguintes viram cards menores. */
  protected readonly featured = computed(() => this.articles()[0] ?? null);
  protected readonly secondary = computed(() => this.articles().slice(1, 3));

  /** Lista de notícias agrupada por dia ("Hoje", "Ontem", "12 de nov."). */
  protected readonly articleDays = computed<ArticleDay[]>(() => {
    const days = new Map<string, Article[]>();
    for (const article of this.articles().slice(3)) {
      const label = this.dayLabel(article.publishedAt);
      days.set(label, [...(days.get(label) ?? []), article]);
    }
    return [...days].map(([label, articles]) => ({ label, articles }));
  });

  protected isWinner(match: Match, side: 1 | 2): boolean {
    if (match.status !== 'finished') return false;
    return side === 1 ? match.team1Score > match.team2Score : match.team2Score > match.team1Score;
  }

  private dayLabel(iso: string): string {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    if (same(date, today)) return 'Hoje';
    if (same(date, yesterday)) return 'Ontem';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }
}
