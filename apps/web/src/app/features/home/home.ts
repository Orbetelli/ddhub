import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, combineLatest, map, of } from 'rxjs';

import { NewsService } from '../../core/services/news.service';
import { LiveService } from '../../core/services/live.service';
import { SceneService } from '../../core/services/scene.service';
import { StatsService } from '../../core/services/stats.service';
import { CreatorsService } from '../../core/services/creators.service';
import { ARTICLE_CATEGORY_LABEL, ArticleCategory } from '../../core/models/portal.models';
import { NewsItem } from '../../core/models/news.models';
import { Creator } from '../../core/models/creator.models';
import { MatchCard, TeamCard, initials } from '../../core/models/scene.models';
import { MatchRow } from '../../shared/match-row/match-row';
import { VideoCard } from '../../shared/video-card/video-card';
import { Video, VideosService } from '../../core/services/videos.service';
import { dailyNumberToday } from '../../core/services/daily.service';
import { EMPTY_HERO_STATS } from '../../core/models/stats.models';

/** Card da faixa "Em 30 segundos". */
interface QuickCard {
  key: string;
  tag: string;
  tone: ArticleCategory | 'meta';
  big: string;
  text: string;
  link: string;
}

interface LearnLink {
  time: string;
  title: string;
  link: string;
}

const DAY = 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-home',
  imports: [RouterLink, DatePipe, MatchRow, VideoCard],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly newsService = inject(NewsService);
  private readonly scene = inject(SceneService);
  private readonly stats = inject(StatsService);
  private readonly creatorsService = inject(CreatorsService);
  protected readonly live = inject(LiveService);

  protected readonly categoryLabel = ARTICLE_CATEGORY_LABEL;
  protected readonly initials = initials;

  private readonly news = toSignal(this.newsService.list().pipe(catchError(() => of<NewsItem[]>([]))), {
    initialValue: [] as NewsItem[],
  });
  private readonly teams = toSignal(this.scene.teams().pipe(catchError(() => of<TeamCard[]>([]))), {
    initialValue: [] as TeamCard[],
  });
  private readonly creators = toSignal(this.creatorsService.list().pipe(catchError(() => of<Creator[]>([]))), {
    initialValue: [] as Creator[],
  });
  /** Ao vivo e próximas primeiro; se não tiver, os últimos resultados. */
  protected readonly matches = toSignal(
    combineLatest([
      this.scene.matches({ status: 'upcoming', limit: 3 }).pipe(catchError(() => of<MatchCard[]>([]))),
      this.scene.matches({ status: 'results', limit: 3 }).pipe(catchError(() => of<MatchCard[]>([]))),
    ]).pipe(map(([next, last]) => (next.length ? next : last))),
    { initialValue: [] as MatchCard[] },
  );

  /** Últimos vídeos de Deadlock dos criadores BR. */
  protected readonly videos = toSignal(inject(VideosService).list(8), { initialValue: [] as Video[] });

  private readonly heroStats = toSignal(this.stats.heroes(), { initialValue: EMPTY_HERO_STATS });

  protected readonly patch = computed(() => this.newsService.meta().patch);
  protected readonly loaded = computed(() => this.news().length > 0);

  /** Quem está ao vivo (stories do topo). */
  protected readonly streams = computed(() => this.live.snapshot().streams.slice(0, 10));

  /** Destaque = notícia mais recente. */
  protected readonly featured = computed(() => this.news()[0] ?? null);

  /** Herói com maior win rate desde o patch. */
  protected readonly topHero = computed(() => this.heroStats().heroes[0] ?? null);

  /** Arte de até 3 heróis em alta: fundo do destaque quando a notícia não tem imagem. */
  protected readonly collage = computed(() =>
    this.heroStats()
      .heroes.filter((h) => h.art)
      .slice(0, 3)
      .map((h) => ({ slug: h.slug, art: h.art! })),
  );

  /** Heróis que o último patch mexeu (ícones no card laranja). */
  protected readonly patchHeroes = computed(() => this.patch()?.heroes ?? []);

  /** Times ativos com mais gente no elenco. */
  protected readonly topTeams = computed(() =>
    this.teams()
      .filter((t) => t.is_active)
      .sort((a, b) => b.roster_count - a.roster_count || a.name.localeCompare(b.name, 'pt-BR'))
      .slice(0, 3),
  );

  /** "Em 30 segundos": um número grande e uma frase. Montado só com dados reais. */
  protected readonly quick = computed<QuickCard[]>(() => {
    const cards: QuickCard[] = [
      // Jogo diário sempre em primeiro: motivo para voltar todo dia
      { key: 'daily', tag: 'Jogo diário', tone: 'meta', big: `#${dailyNumberToday()}`, text: '4 desafios novos: habilidade, item, mob e mapa. Quantos você acerta?', link: '/diario' },
    ];

    for (const n of this.news().slice(1, 4)) {
      cards.push({
        key: `news-${n.slug}`,
        tag: this.categoryLabel[n.category],
        tone: n.category,
        big: this.freshLabel(n.published_at),
        text: n.title,
        link: `/noticias/${n.slug}`,
      });
    }

    const hero = this.topHero();
    if (hero) {
      cards.push({
        key: 'hero',
        tag: 'Meta',
        tone: 'meta',
        big: this.pct(hero.win_rate),
        text: `${hero.name} tem o maior win rate no ${this.heroStats().badge} desde o patch`,
        link: `/herois/${hero.slug}`,
      });
    }

    const live = this.live.snapshot().streams.length;
    const creators = this.creators().length;
    if (live > 0) {
      cards.push({ key: 'live', tag: 'Ao vivo', tone: 'comunidade', big: String(live), text: live === 1 ? 'criador BR ao vivo agora em Deadlock' : 'criadores BR ao vivo agora em Deadlock', link: '/criadores' });
    } else if (creators > 0) {
      cards.push({ key: 'creators', tag: 'Comunidade', tone: 'comunidade', big: String(creators), text: 'criadores BR de Deadlock pra você seguir', link: '/criadores' });
    }

    const teams = this.teams().filter((t) => t.is_active).length;
    if (teams > 0) {
      cards.push({ key: 'teams', tag: 'Cenário', tone: 'cenario', big: String(teams), text: teams === 1 ? 'time BR na Cena do DDhub' : 'times BR na Cena do DDhub', link: '/times' });
    }

    return cards;
  });

  protected readonly learn: LearnLink[] = [
    { time: '2 min', title: 'O básico do jogo', link: '/aprender/o-basico' },
    { time: '2 min', title: 'Como funcionam as lanes', link: '/aprender/lanes' },
    { time: '2 min', title: 'Itens que todo mundo compra', link: '/aprender/itens' },
    { time: '30 s', title: 'Glossário rápido', link: '/aprender/glossario' },
  ];

  protected pct(value: number): string {
    return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }

  protected viewers(n: number): string {
    return n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : String(n);
  }

  /** "há 3 dias", "hoje"… para o selo do destaque. */
  protected ago(iso: string): string {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
    if (days <= 0) return 'hoje';
    if (days === 1) return 'ontem';
    return `há ${days} dias`;
  }

  /** Número grande dos cards de notícia: "NOVO" nas últimas 48h, senão a data. */
  private freshLabel(iso: string): string {
    const date = new Date(iso);
    if (Date.now() - date.getTime() < 2 * DAY) return 'NOVO';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  /** Texto gigante ao fundo do destaque. */
  protected backdrop(n: NewsItem): string {
    return n.category === 'patch' ? 'PATCH' : this.categoryLabel[n.category].toUpperCase();
  }
}
