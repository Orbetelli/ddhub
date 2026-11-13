import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Bloco padrão do portal: faixa de título com linha laranja, conteúdo projetado
 * e um link opcional de "ver mais" no rodapé.
 *
 * <app-panel heading="Notícias" moreLink="/noticias" moreLabel="Arquivo de notícias »">
 *   <a panel-action routerLink="/builds/nova">+ Criar build</a>   <!-- opcional, vai no cabeçalho -->
 *   ...linhas...
 * </app-panel>
 */
@Component({
  selector: 'app-panel',
  imports: [RouterLink],
  templateUrl: './panel.html',
  styleUrl: './panel.scss',
})
export class Panel {
  readonly heading = input.required<string>();
  readonly moreLink = input<string>();
  readonly moreLabel = input('Ver mais »');
}
