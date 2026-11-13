// Dados de EXEMPLO para montar as telas antes da API existir.
// Times, jogadores e manchetes são fictícios.
// Quando o NestJS estiver pronto, o PortalDataService passa a buscar da API
// e este arquivo pode ser apagado.

import {
  Article,
  BuildSummary,
  ForumTopic,
  HeroStat,
  Match,
  TeamRef,
  Tournament,
  Transfer,
} from '../models/portal.models';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Data relativa a agora, para "Hoje"/"Ontem" sempre fazerem sentido no mock. */
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const team = (slug: string, name: string): TeamRef => ({ slug, name });
const A = team('time-a', 'Time A');
const B = team('time-b', 'Time B');
const C = team('time-c', 'Time C');
const D = team('time-d', 'Time D');
const E = team('time-e', 'Time E');
const F = team('time-f', 'Time F');
const G = team('time-g', 'Time G');

export const MOCK_MATCHES = (): Match[] => [
  { id: 'm1', tournament: '[Torneio BR]', team1: A, team2: B, team1Score: 1, team2Score: 0, bestOf: 3, status: 'live', scheduledAt: at(-1 * HOUR) },
  { id: 'm2', tournament: '[Cup amador]', team1: C, team2: D, team1Score: 0, team2Score: 0, bestOf: 1, status: 'scheduled', scheduledAt: at(3 * HOUR) },
  { id: 'm3', tournament: '[Liga LATAM]', team1: E, team2: F, team1Score: 0, team2Score: 0, bestOf: 3, status: 'scheduled', scheduledAt: at(5 * HOUR) },
  { id: 'm4', tournament: '[Liga LATAM]', team1: G, team2: A, team1Score: 2, team2Score: 1, bestOf: 3, status: 'finished', scheduledAt: at(-1 * DAY) },
  { id: 'm5', tournament: '[Cup amador]', team1: B, team2: E, team1Score: 0, team2Score: 2, bestOf: 3, status: 'finished', scheduledAt: at(-1 * DAY - 3 * HOUR) },
];

export const MOCK_TOURNAMENTS = (): Tournament[] => [
  { slug: 'torneio-br-1', name: '[Torneio BR #1]', statusLabel: 'em andamento' },
  { slug: 'liga-latam', name: '[Liga LATAM]', statusLabel: 'semana 3' },
  { slug: 'cup-amador', name: '[Cup amador]', statusLabel: 'inscrições abertas' },
];

export const MOCK_ARTICLES = (): Article[] => [
  { slug: 'patch-resumo', category: 'patch', title: '[Manchete] O que mudou no patch e quais builds ainda funcionam', excerpt: 'Resumo do patch em português, com os heróis e itens que mais mudaram.', publishedAt: at(-1 * HOUR), commentCount: 0 },
  { slug: 'guia-farm-almas', category: 'guia', title: '[Manchete] Farm de almas: o guia que eu queria ter lido no dia 1', publishedAt: at(-2 * HOUR), commentCount: 0 },
  { slug: 'times-br-torneios', category: 'cenario', title: '[Manchete] Os times brasileiros que estão aparecendo nos torneios abertos', publishedAt: at(-3 * HOUR), commentCount: 0 },
  { slug: 'itens-spirit', category: 'patch', title: '[Manchete] Itens de Spirit mais caros: o que comprar no lugar', publishedAt: at(-4 * HOUR), commentCount: 0 },
  { slug: 'quando-sair-da-lane', category: 'guia', title: '[Manchete] Quando sair da lane e pra onde rotacionar', publishedAt: at(-5 * HOUR), commentCount: 0 },
  { slug: 'clipes-semana', category: 'comunidade', title: '[Manchete] Os clipes mais absurdos da semana', publishedAt: at(-1 * DAY), commentCount: 0 },
  { slug: 'erros-iniciante', category: 'guia', title: '[Manchete] 5 erros que todo iniciante comete (e como parar)', publishedAt: at(-1 * DAY - 2 * HOUR), commentCount: 0 },
];

export const MOCK_TRANSFERS = (): Transfer[] => [
  { id: 't1', player: 'Jogador 1', from: 'Time A', to: 'Time C', happenedAt: at(-1 * DAY) },
  { id: 't2', player: 'Jogador 2', from: null, to: 'Time E', happenedAt: at(-2 * DAY) },
  { id: 't3', player: 'Jogador 3', from: 'Time G', to: 'Time B', happenedAt: at(-3 * DAY) },
];

export const MOCK_TOPICS = (): ForumTopic[] => [
  { id: 'f1', title: 'Qual herói vocês indicam pra quem tá começando?', category: 'Iniciantes', replyCount: 0 },
  { id: 'f2', title: 'Haze no patch atual: arma ou spirit?', category: 'Builds', replyCount: 0 },
  { id: 'f3', title: 'Procuro time pra cup amadora (BR, noite)', category: 'Procuro time', replyCount: 0 },
  { id: 'f4', title: 'Quando vale comprar vitalidade?', category: 'Iniciantes', replyCount: 0 },
  { id: 'f5', title: 'Servidor BR: ping alto pra mais alguém?', category: 'Off-topic', replyCount: 0 },
  { id: 'f6', title: 'Posta aqui seu clipe mais insano', category: 'Off-topic', replyCount: 0 },
];

export const MOCK_HEROES = (): HeroStat[] => [
  { slug: 'haze', name: 'Haze', winRate: null },
  { slug: 'infernus', name: 'Infernus', winRate: null },
  { slug: 'seven', name: 'Seven', winRate: null },
  { slug: 'abrams', name: 'Abrams', winRate: null },
  { slug: 'lady-geist', name: 'Lady Geist', winRate: null },
  { slug: 'mcginnis', name: 'McGinnis', winRate: null },
];

export const MOCK_BUILDS = (): BuildSummary[] => [
  { id: 'b1', hero: 'Haze', title: 'Arma pura, sem frescura', author: 'usuario_1', score: 0 },
  { id: 'b2', hero: 'Infernus', title: 'Queimando tudo na lane', author: 'usuario_2', score: 0 },
  { id: 'b3', hero: 'Abrams', title: 'Tank que não morre', author: 'usuario_3', score: 0 },
  { id: 'b4', hero: 'Seven', title: 'Spirit pro late game', author: 'usuario_4', score: 0 },
];
