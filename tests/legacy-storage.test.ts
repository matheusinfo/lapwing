// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { migrateLegacyKeys } from '../src/app/legacy-storage';

describe('migrateLegacyKeys', () => {
  it('moves route-maker: keys to lapwing: without overwriting newer values', () => {
    localStorage.clear();
    localStorage.setItem('route-maker:lang', 'pt-BR');
    localStorage.setItem('route-maker:pace', '5:30');
    localStorage.setItem('lapwing:pace', '6:00');
    localStorage.setItem('other', 'x');

    migrateLegacyKeys(localStorage);

    expect(localStorage.getItem('lapwing:lang')).toBe('pt-BR');
    expect(localStorage.getItem('lapwing:pace')).toBe('6:00');
    expect(localStorage.getItem('route-maker:lang')).toBeNull();
    expect(localStorage.getItem('route-maker:pace')).toBeNull();
    expect(localStorage.getItem('other')).toBe('x');
  });
});
