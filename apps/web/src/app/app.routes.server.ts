import { RenderMode, ServerRoute } from '@angular/ssr';

// Renderiza no servidor a cada requisição (bom para SEO e conteúdo que muda:
// notícias, partidas, fórum). Páginas estáticas podem virar Prerender depois.
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
