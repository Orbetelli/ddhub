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
    path: '',
    title: 'DDhub — Deadlock BR',
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
  },

  ...section('noticias', 'Notícias', 'slug'),
  ...section('partidas', 'Partidas', 'id'),
  ...section('torneios', 'Torneios', 'slug'),
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
  ...section('itens', 'Itens', 'slug'),
  ...section('builds', 'Builds', 'id'),
  ...section('times', 'Times', 'slug'),
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
  { path: 'transferencias', title: 'Transferências · DDhub', loadComponent: placeholder, data: { heading: 'Transferências' } },

  {
    path: '**',
    title: 'Página não encontrada · DDhub',
    loadComponent: placeholder,
    data: { heading: 'Página não encontrada', notFound: true },
  },
];