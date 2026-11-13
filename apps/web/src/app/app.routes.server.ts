import { RenderMode, ServerRoute } from '@angular/ssr';

// Por enquanto o site roda no navegador (Client): é o jeito simples de publicar
// na Vercel. Quando formos cuidar de SEO, voltamos para RenderMode.Server.
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
];
