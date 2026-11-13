// Formato da resposta de GET /map (API NestJS)

export type MarkerKind =
  | 'guardiao'
  | 'andador'
  | 'guardiao-base'
  | 'santuario'
  | 'patrono'
  | 'chefe-meio'
  | 'base'
  | 'acampamento'
  | 'outro';

export interface MapMarker {
  id: string;
  kind: MarkerKind;
  team: 0 | 1 | null;
  size: 'pequeno' | 'medio' | 'grande' | 'cofre' | null;
  lane: number | null;
  icon: string | null;
  x: number;
  y: number;
  source: string;
}

export interface MapView {
  key: string;
  label: string;
  url: string;
}

export interface MapData {
  image: string | null;
  views: MapView[];
  markers: MapMarker[];
}

export interface KindInfo {
  label: string;
  /** Texto curto explicando o objetivo (aparece no painel ao clicar). */
  text: string;
  /** Capítulo do guia "Aprender a jogar" com mais detalhes. */
  learn: string | null;
}

/** Textos de cada tipo de marcador. Mantidos em linha com os capítulos do guia. */
export const KIND_INFO: Record<MarkerKind, KindInfo> = {
  guardiao: {
    label: 'Guardião',
    text: 'Primeira defesa de cada lane. Começa muito resistente e vai ficando mais fraco com o tempo de jogo. Lutar perto do seu Guardião é vantagem.',
    learn: '/aprender/objetivos',
  },
  andador: {
    label: 'Andador',
    text: 'O robô gigante atrás do Guardião. Só pode ser atacado depois que o Guardião da lane cai. Derrubá-lo paga almas para o time todo.',
    learn: '/aprender/objetivos',
  },
  'guardiao-base': {
    label: 'Guardião da Base',
    text: 'Dupla na entrada da base. Enquanto um par de Guardiões da Base estiver de pé, os Santuários ficam invulneráveis.',
    learn: '/aprender/objetivos',
  },
  santuario: {
    label: 'Santuário',
    text: 'São dois dentro de cada base. Os dois precisam cair para o Patrono ficar vulnerável.',
    learn: '/aprender/objetivos',
  },
  patrono: {
    label: 'Patrono',
    text: 'O objetivo final. Tem duas fases: na fase enfraquecida, defensores dentro do fosso dão resistência a ele. Derrubou, venceu.',
    learn: '/aprender/patrono',
  },
  'chefe-meio': {
    label: 'Chefe do Meio',
    text: 'Fica embaixo do centro do mapa. Ao morrer, solta o Rejuvenescedor em 3 cristais que podem ser pegos pelos dois times.',
    learn: '/aprender/mid-boss',
  },
  base: {
    label: 'Base',
    text: 'O coração da base de cada time. Para chegar no Patrono, é preciso passar pelos Guardiões da Base e derrubar os dois Santuários.',
    learn: '/aprender/objetivos',
  },
  acampamento: {
    label: 'Acampamento neutro',
    text: 'Monstros neutros que dão almas. Quanto maior o acampamento, mais almas e mais perigo.',
    learn: '/aprender/jungle',
  },
  outro: {
    label: 'Outro ponto',
    text: 'Ponto do mapa ainda sem descrição no DDhub.',
    learn: null,
  },
};

/** Lanes como aparecem nos dados (tier1_1, tier1_3, tier1_4). */
export const LANE_LABEL: Record<number, string> = {
  1: 'Lane amarela (York)',
  3: 'Lane azul (Broadway)',
  4: 'Lane verde (Park)',
};

export const TEAM_LABEL: Record<0 | 1, string> = {
  0: 'The Hidden King',
  1: 'The Archmother',
};