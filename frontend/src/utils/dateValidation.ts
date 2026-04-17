/**
 * Guards against invalid Date values from MUI DatePicker / TimePicker keyboard input
 * (e.g. 00/00/0000), which are truthy but break comparisons and toISOString().
 */

export function sanitizePickerDate(value: Date | null | undefined): Date | null {
  if (value == null) return null;
  return Number.isNaN(value.getTime()) ? null : value;
}

export function isValidDate(value: Date | null | undefined): value is Date {
  return value != null && !Number.isNaN(value.getTime());
}
