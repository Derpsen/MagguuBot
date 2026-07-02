import { z } from 'zod';

export function emptyEnvToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

export function envBoolean(defaultValue: boolean): z.ZodType<boolean> {
  return z.preprocess((value) => {
    if (value === undefined) return defaultValue;
    if (typeof value !== 'string') return value;

    switch (value.trim().toLowerCase()) {
      case 'true':
      case '1':
        return true;
      case 'false':
      case '0':
        return false;
      default:
        return value;
    }
  }, z.boolean());
}
