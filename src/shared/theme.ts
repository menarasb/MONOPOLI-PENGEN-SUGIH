import indonesia from '../../theme/indonesia.json' with { type: 'json' };
import charactersData from '../../theme/characters.json' with { type: 'json' };
import type { CharacterDef, Theme } from './types.js';
import { Engine } from './engine.js';

export const THEMES: Record<string, Theme> = { indonesia: indonesia as unknown as Theme };
export const DEFAULT_THEME = 'indonesia';

export const CHARACTERS = charactersData.characters as CharacterDef[];
export const CHARACTER_PACKS = charactersData.packs;
export const CHARACTER_DISCLAIMER = charactersData.disclaimer;

const engines = new Map<string, Engine>();
export function getEngine(themeId = DEFAULT_THEME): Engine {
  let e = engines.get(themeId);
  if (!e) {
    e = new Engine(THEMES[themeId]);
    engines.set(themeId, e);
  }
  return e;
}
