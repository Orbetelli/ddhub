import { Component, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { marked } from 'marked';

import { AssetRefsService } from '../../core/services/asset-refs.service';
import { NamePreferenceService } from '../../core/services/name-preference.service';
import { expandShortcodes } from './shortcodes';

/**
 * Renderiza Markdown (capítulos do guia, guias de herói, notícias).
 * - Expande os atalhos {{heroi:..}}, {{item:..}}, {{npc:..}}, {{imagem:..}} (ver shortcodes.ts)
 * - Respeita a preferência de nomes PT/EN
 * - Links internos (/herois/..., /aprender/...) navegam pelo Angular, sem recarregar a página
 * O [innerHTML] do Angular sanitiza o HTML final (remove <script>, onclick etc.).
 *
 * <app-markdown [source]="texto" />
 */
@Component({
  selector: 'app-markdown',
  template: `<div class="md" [innerHTML]="html()" (click)="onClick($event)"></div>`,
  styleUrl: './markdown.scss',
  // O HTML gerado não recebe os atributos de encapsulamento,
  // então os estilos ficam globais mas presos à classe .md
  encapsulation: ViewEncapsulation.None,
})
export class Markdown {
  readonly source = input<string | null | undefined>('');

  private readonly refs = inject(AssetRefsService).refs;
  private readonly names = inject(NamePreferenceService);
  private readonly router = inject(Router);

  protected readonly html = computed(() => {
    // lê o idioma aqui para recalcular quando o usuário trocar PT/EN
    this.names.lang();
    const expanded = expandShortcodes(this.source() ?? '', this.refs(), (pt, en) => this.names.primary(pt, en));
    return marked.parse(expanded, { async: false, gfm: true }) as string;
  });

  /** Links que começam com "/" viram navegação do Angular. */
  protected onClick(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const link = (event.target as HTMLElement | null)?.closest('a');
    const href = link?.getAttribute('href');
    if (!href || !href.startsWith('/') || href.startsWith('//')) return;
    event.preventDefault();
    void this.router.navigateByUrl(href);
  }
}