/**
 * Textos da Política de Privacidade e dos Termos de Uso (LGPD — Lei 13.709/2018).
 *
 * ⚠️ ANTES DE PUBLICAR: troque CONTACT_EMAIL pelo e-mail de contato do DDhub.
 * Quando o login (Steam/Discord) for lançado, revise a seção "Conta" e mude UPDATED_AT.
 */
export const CONTACT_EMAIL = 'COLOQUE-SEU-EMAIL-AQUI@gmail.com';
export const UPDATED_AT = '24 de novembro de 2026';

export interface LegalDoc {
  title: string;
  intro: string;
  body: string;
}

const privacy = `
## 1. Quem somos

O DDhub é um portal feito por fãs para a comunidade brasileira de Deadlock, mantido por uma pessoa física (o "controlador", nos termos da LGPD). **Não temos vínculo com a Valve.** Para qualquer assunto sobre seus dados, fale com a gente em **${CONTACT_EMAIL}**.

## 2. O que coletamos hoje

O DDhub **ainda não tem cadastro nem login**. Hoje funciona assim:

- **Preferência de nomes (PT/EN) e progresso do jogo diário:** ficam salvos só no seu navegador (localStorage), não chegam até nós. Você apaga limpando os dados do site no navegador.
- **Registros técnicos de acesso:** as empresas que hospedam o site (Vercel) e a API (Render) guardam, por pouco tempo, registros como endereço IP, data e página acessada, para segurança e funcionamento. Nós não usamos esses dados para identificar ninguém.
- **Sem cookies de rastreamento:** não usamos Google Analytics, pixel de anúncio nem nada parecido.

## 3. Dados públicos de jogadores, times e criadores

Nas páginas de **Cena** e **Criadores** mostramos informações **públicas**: nick, time, histórico de times, resultados de torneios e links de canais (Twitch, Kick, YouTube etc.), com fotos de perfil vindas dessas plataformas. Essas informações vêm de fontes públicas (Liquipedia, páginas de torneios, as próprias plataformas) e são tratadas com base no **legítimo interesse** de informar a comunidade sobre o cenário (art. 7º, IX, e art. 7º, §4º, da LGPD).

- **Nome real e foto pessoal** só aparecem com autorização da pessoa.
- Se você aparece no site e quer **corrigir, completar ou remover** alguma informação, mande um e-mail para **${CONTACT_EMAIL}**. Respondemos em até 15 dias.

## 4. Conta (login com Steam)

O login é feito **no site da própria Steam**: você digita a senha lá, nunca no DDhub. A Steam nos devolve só o seu **SteamID64** (número público da conta), e conferimos direto com a Steam que a resposta é verdadeira. Com esse número, buscamos na Steam o seu **nome e avatar públicos**.

- **O que guardamos:** SteamID64, nome e avatar da Steam, um nome de usuário no DDhub e a data do último login. **Não recebemos sua senha, e-mail, lista de amigos nem dados de pagamento.**
- **Cookie de sessão:** ao entrar, o site grava um cookie essencial (*ddhub_session*) para lembrar que você está logado, por até 30 dias. Ele é *httpOnly* (nenhum script consegue ler), e no nosso banco fica só uma versão embaralhada (hash) dele. Ao clicar em **Sair**, a sessão é apagada.
- **Base legal:** execução do serviço que você pediu (art. 7º, V, da LGPD).
- **Seu perfil e seus dados:** em **Minha conta** você muda o nome de exibição, o @ e a bio, sai de todos os aparelhos e baixa um arquivo com tudo o que guardamos sobre a sua conta.
- **Excluir a conta:** em **Minha conta → Excluir conta**. A exclusão é imediata: apagamos o perfil, a ligação com a Steam e as sessões. Se preferir, peça por **${CONTACT_EMAIL}**.

Quando o login com **Discord** e o fórum entrarem no ar, esta seção será atualizada.

## 5. Serviços de terceiros

Para funcionar, o site carrega conteúdo de outros serviços. Ao abrir uma página, seu navegador pode se comunicar com eles (e eles podem ver seu IP):

- **Google Fonts** (fontes do site);
- **Twitch, Kick e Steam** (avatares, miniaturas das lives e imagens do jogo);
- **YouTube** (miniaturas dos vídeos dos criadores; os vídeos abrem no próprio YouTube);
- **Deadlock API** (dados e imagens de heróis e itens).

Os dados do site ficam no **Supabase**. As notícias da Steam são traduzidas automaticamente com a **Groq** (só o texto público dos anúncios, nenhum dado seu). Links para sites externos seguem as políticas desses sites.

## 6. Seus direitos

Pela LGPD (art. 18), você pode pedir a qualquer momento: confirmação de que tratamos seus dados, acesso, correção, anonimização ou exclusão, informação sobre com quem compartilhamos e revisão de decisões. É só escrever para **${CONTACT_EMAIL}**. Você também pode reclamar à **ANPD** (Autoridade Nacional de Proteção de Dados).

## 7. Segurança e por quanto tempo guardamos

Os dados ficam em serviços com acesso protegido e só o necessário é guardado. Informações de jogadores e times ficam enquanto fizerem parte da história do cenário, a menos que a pessoa peça a remoção. Dados de conta são apagados se você excluir a conta. Sessões vencidas ou encerradas são apagadas automaticamente.

## 8. Crianças e adolescentes

O DDhub não é voltado para crianças. Para entrar com a Steam, é preciso ter **13 anos ou mais**, e menores de 18 anos devem ter autorização dos responsáveis.

## 9. Mudanças

Se esta política mudar, a data no topo da página será atualizada. Mudanças importantes serão avisadas no site.
`;

const terms = `
## 1. O que é o DDhub

O DDhub é um site de fã, gratuito, sobre o jogo **Deadlock**. Não temos vínculo, patrocínio ou aprovação da **Valve Corporation**. Deadlock, seus heróis, itens e imagens são marcas e propriedade da Valve. Dados do jogo vêm da comunidade (Deadlock API) e da Steam.

## 2. Usando o site

Você pode navegar à vontade. Pedimos só que não tente derrubar, invadir ou sobrecarregar o site, nem copiar o conteúdo em massa de forma automatizada.

## 3. Conteúdo do site

Guias, traduções, textos e a organização do conteúdo são feitos pela equipe do DDhub. Pode compartilhar à vontade, **dando o crédito e o link**. As notícias oficiais vêm da Steam e são **traduzidas automaticamente**: em caso de dúvida, vale o texto original em inglês (sempre disponível na página).

Estatísticas, resultados e informações de torneios são reunidos de fontes públicas e podem conter erros. Achou algo errado? Avise em **${CONTACT_EMAIL}**.

## 4. Contas e participação

Você pode entrar com a sua conta Steam. Ao usar a conta e, quando o fórum estiver no ar, ao publicar algo, você:

- precisa ter **13 anos ou mais** (menores de 18, com autorização dos responsáveis);
- é responsável pelo que escreve;
- não pode publicar: ofensas, discriminação, assédio, ameaças, conteúdo sexual, spam, golpes, venda de contas, cheats ou dados pessoais de outras pessoas;
- permite que o DDhub exiba o conteúdo no site (ele continua sendo seu).

Podemos remover conteúdo ou suspender contas que desrespeitem estas regras.

## 5. Links e serviços de terceiros

O site tem links e conteúdo de outras plataformas (Twitch, Kick, YouTube, Steam etc.). Não controlamos esses serviços e eles têm termos próprios.

## 6. Sem garantias

O DDhub é um projeto da comunidade, oferecido "como está". Fazemos o possível para manter tudo certo e no ar, mas o site pode ficar fora do ar ou ter informações desatualizadas.

## 7. Mudanças e contato

Estes termos podem mudar; a data no topo da página será atualizada. Dúvidas: **${CONTACT_EMAIL}**. Vale a lei brasileira.
`;

export const LEGAL_DOCS: Record<'privacidade' | 'termos', LegalDoc> = {
  privacidade: {
    title: 'Política de Privacidade',
    intro: 'Como o DDhub trata dados pessoais, em linguagem simples e de acordo com a LGPD.',
    body: privacy,
  },
  termos: {
    title: 'Termos de Uso',
    intro: 'As regras para usar o DDhub. Curto e direto.',
    body: terms,
  },
};
