import { Component, ViewEncapsulation, computed, input } from '@angular/core';
import { marked } from 'marked';

/**
 * Renderiza Markdown (capítulos do guia, guias de herói, notícias).
 * O [innerHTML] do Angular já sanitiza o HTML (remove <script>, onclick etc.).
 *
 * <app-markdown [source]="texto" />
 */
@Component({
  selector: 'app-markdown',
  template: `<div class="md" [innerHTML]="html()"></div>`,
  styleUrl: './markdown.scss',
  // O HTML gerado não recebe os atributos de encapsulamento,
  // então os estilos ficam globais mas presos à classe .md
  encapsulation: ViewEncapsulation.None,
})
export class Markdown {
  readonly source = input<string | null | undefined>('');

  protected readonly html = computed(
    () => marked.parse(this.source() ?? '', { async: false, gfm: true }) as string,
  );
}