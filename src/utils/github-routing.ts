export const DEFAULT_ADDON_REPOSITORIES = 'Derpsen/MagguuUI';

export function parseAddonRepositories(raw: string | undefined): Set<string> {
  return new Set(
    (raw || DEFAULT_ADDON_REPOSITORIES)
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAddonRepository(fullName: string | undefined, repositories: Set<string>): boolean {
  return Boolean(fullName && repositories.has(fullName.toLowerCase()));
}
