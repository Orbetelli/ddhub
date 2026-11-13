import { Injectable, PLATFORM_ID, afterNextRender, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type NameLang = 'pt' | 'en';

const STORAGE_KEY = 'ddhub.nameLang';

/**
 * Preferência "nomes em PT ou EN" (igual à opção "Force English Hero Names" do jogo).
 * Fica salva no navegador. O SSR sempre renderiza em PT; a preferência salva
 * é aplicada logo após a hidratação, para o HTML do servidor e do navegador baterem.
 */
@Injectable({ providedIn: 'root' })
export class NamePreferenceService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly _lang = signal<NameLang>('pt');

  constructor() {
    afterNextRender(() => this._lang.set(this.load()));
  }

  readonly lang = this._lang.asReadonly();
  readonly isEnglish = computed(() => this._lang() === 'en');

  set(lang: NameLang): void {
    this._lang.set(lang);
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* navegador sem storage (modo privado etc.): só não lembra */
    }
  }

  toggle(): void {
    this.set(this.isEnglish() ? 'pt' : 'en');
  }

  /** Nome principal conforme a preferência. */
  primary(name: string, nameEn: string | null | undefined): string {
    return this.isEnglish() && nameEn ? nameEn : name;
  }

  /** Nome secundário (o "outro" idioma), ou null se forem iguais. */
  secondary(name: string, nameEn: string | null | undefined): string | null {
    if (!nameEn || nameEn === name) return null;
    return this.isEnglish() ? name : nameEn;
  }

  private load(): NameLang {
    if (!this.isBrowser) return 'pt';
    try {
      return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'pt';
    } catch {
      return 'pt';
    }
  }
}