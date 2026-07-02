export function isMaintainerrEventCode(value: string): boolean {
  return /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(value.trim());
}
