import { Routes } from '@angular/router';

const placeholder = () => import('./features/placeholder/placeholder').then((m) => m.Placeholder);

/**
 * Cria a rota da listagem e a rota de detalhe de uma seção.
 * Por enquanto as duas usam a página provisória; quando a seção for
 * construída, troque o loadComponent pelo componente real.
 */
const section = (path: string, heading: string, detailParam: string): Routes => [
  { path, title: `${heading} · DDhub`, loadComponent: placeholder, data: { heading } },
  { path: `${path}/:${detailParam}`, title: `${heading} · DDhub`, loadComponent: placeholder, data: { heading } },
];

export const routes: Routes = [
  {
    path: 'conta',
    title: 'Minha conta · DDhub',
    loadComponent: () => import('./features/account/account-page').then((m) => m.AccountPage),
  },
  {
    path: 'u/:username',
    title: 'Perfil · DDhub',
    loadComponent: () => import('./features/account/user-profile').then((m) => m.UserProfile),
  },
  {
    path: 'privacidade',
    title: 'Política de Privacidade · DDhub',
    loadComponent: () => import('./features/legal/legal-page').then((m) => m.LegalPage),
    data: { kind: 'privacidade' },
  },
  {
    path: 'termos',
    title: 'Termos de Uso · DDhub',
    loadComponent: () => import('./features/legal/legal-page').then((m) => m.LegalPage),
    data: { kind: 'termos' },
  },
  {
    path: '',
    title: 'DDhub — Deadlock BR',
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
  },

  {
    path: 'noticias',
    title: 'Notícias · DDhub',
    loadComponent: () => import('./features/news/news-list').then((m) => m.NewsList),
  },
  {
    path: 'noticias/:slug',
    title: 'Notícia · DDhub',
    loadComponent: () => import('./features/news/news-article').then((m) => m.NewsArticle),
  },
  {
    path: 'partidas',
    title: 'Partidas · DDhub',
    loadComponent: () => import('./features/scene/match-list').then((m) => m.MatchList),
  },
  { path: 'partidas/:id', redirectTo: 'partidas' },
  {
    path: 'torneios',
    title: 'Torneios · DDhub',
    loadComponent: () => import('./features/scene/tournament-list').then((m) => m.TournamentList),
  },
  {
    path: 'torneios/:slug',
    title: 'Torneio · DDhub',
    loadComponent: () => import('./features/scene/tournament-detail').then((m) => m.TournamentDetail),
  },
  {
    path: 'herois',
    title: 'Heróis · DDhub',
    loadComponent: () => import('./features/heroes/hero-list/hero-list').then((m) => m.HeroList),
  },
  {
    path: 'herois/:slug',
    title: 'Herói · DDhub',
    loadComponent: () => import('./features/heroes/hero-detail/hero-detail').then((m) => m.HeroDetail),
  },
  {
    path: 'itens',
    title: 'Itens · DDhub',
    loadComponent: () => import('./features/items/item-list/item-list').then((m) => m.ItemList),
  },
  {
    path: 'itens/:slug',
    title: 'Item · DDhub',
    loadComponent: () => import('./features/items/item-detail/item-detail').then((m) => m.ItemDetail),
  },
  {
    path: 'diario',
    title: 'DDhub Diário · DDhub',
    loadComponent: () => import('./features/daily/daily-page').then((m) => m.DailyPage),
  },
  // Endereço da 1ª versão do jogo
  { path: 'adivinhe', redirectTo: 'diario' },
  {
    path: 'videos',
    title: 'Vídeos BR · DDhub',
    loadComponent: () => import('./features/videos/video-list').then((m) => m.VideoList),
  },
  {
    path: 'mapa',
    title: 'Mapa interativo · DDhub',
    loadComponent: () => import('./features/map/map-page').then((m) => m.MapPage),
  },
  {
    path: 'criadores',
    title: 'Criadores BR · DDhub',
    loadComponent: () => import('./features/creators/creator-list').then((m) => m.CreatorList),
  },
  {
    path: 'builds',
    title: 'Builds · DDhub',
    loadComponent: () => import('./features/builds/build-list').then((m) => m.BuildList),
  },
  {
    path: 'builds/nova',
    title: 'Nova build · DDhub',
    loadComponent: () => import('./features/builds/build-editor').then((m) => m.BuildEditor),
  },
  {
    path: 'builds/minhas',
    title: 'Minhas builds · DDhub',
    loadComponent: () => import('./features/builds/my-builds').then((m) => m.MyBuilds),
  },
  {
    path: 'builds/:id/editar',
    title: 'Editar build · DDhub',
    loadComponent: () => import('./features/builds/build-editor').then((m) => m.BuildEditor),
  },
  {
    path: 'builds/:id',
    title: 'Build · DDhub',
    loadComponent: () => import('./features/builds/build-detail').then((m) => m.BuildDetail),
  },
  { path: 'times', title: 'Times · DDhub', loadComponent: () => import('./features/scene/team-list').then((m) => m.TeamList) },
  { path: 'times/:slug', title: 'Time · DDhub', loadComponent: () => import('./features/scene/team-detail').then((m) => m.TeamDetail) },
  { path: 'jogadores/:slug', title: 'Jogador · DDhub', loadComponent: () => import('./features/scene/player-detail').then((m) => m.PlayerDetail) },
  ...section('forum', 'Fórum', 'id'),
  {
    path: 'aprender',
    title: 'Aprender a jogar · DDhub',
    loadComponent: () => import('./features/learn/learn-index/learn-index').then((m) => m.LearnIndex),
  },
  {
    path: 'aprender/:slug',
    title: 'Aprender a jogar · DDhub',
    loadComponent: () => import('./features/learn/learn-chapter/learn-chapter').then((m) => m.LearnChapter),
  },
  { path: 'transferencias', title: 'Transferências · DDhub', loadComponent: () => import('./features/scene/transfers').then((m) => m.Transfers) },

  {
    path: '**',
    title: 'Página não encontrada · DDhub',
    loadComponent: placeholder,
    data: { heading: 'Página não encontrada', notFound: true },
  },
];