import { t } from '../i18n';
import { isUnit, UNIT_ML, UNITS, unitLabelKey, unitNameKey, unitTakesAmount } from './units';

describe('units', () => {
  it('has a label and a name for every unit', () => {
    for (const u of UNITS) {
      expect(t(unitLabelKey(u))).toBeTruthy();
      expect(t(unitNameKey(u))).toBeTruthy();
    }
    expect(t(unitLabelKey('tbsp'))).toBe('tbsp');
  });

  it('knows Polish kitchen volumes', () => {
    expect(UNIT_ML.glass).toBe(250);
    expect(UNIT_ML.tbsp).toBe(15);
    expect(UNIT_ML.tsp).toBe(5);
    expect(UNIT_ML.g).toBeUndefined();
  });

  it('guards and flags units', () => {
    expect(isUnit('kg')).toBe(true);
    expect(isUnit('cup')).toBe(false);
    expect(isUnit(3)).toBe(false);
    expect(unitTakesAmount('to_taste')).toBe(false);
    expect(unitTakesAmount('g')).toBe(true);
  });
});
