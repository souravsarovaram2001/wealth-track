import { format, isValid } from 'date-fns';

/**
 * Safely formats a date string or object.
 * Returns a fallback string if the date is invalid.
 */
export function safeFormat(date: string | number | Date | undefined, formatStr: string, fallback: string = '--'): string {
  if (!date) return fallback;
  const d = new Date(date);
  if (!isValid(d)) return fallback;
  return format(d, formatStr);
}

/**
 * Checks if a date is valid.
 */
export function isDateValid(date: any): boolean {
  if (!date) return false;
  const d = new Date(date);
  return isValid(d);
}
