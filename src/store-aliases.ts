import type { HetangOpsConfig, HetangStoreConfig } from "./types.js";

const STORE_BRAND_PREFIX = /^荷塘悦色/u;
const STORE_SUFFIX = /店$/u;
const MIN_SAFE_SHORT_ALIAS_CHARS = 3;

export type HetangStoreAliasMatch = {
  orgId: string;
  storeName: string;
  matchedAlias: string;
  position: number;
  aliasLength: number;
};

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, "").trim();
}

function dedupeAliases(values: string[]): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    const normalized = normalizeText(trimmed);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(trimmed);
  }
  return ordered;
}

function resolveStoreBrandlessAlias(alias: string): string | undefined {
  const brandless = alias.replace(STORE_BRAND_PREFIX, "").trim();
  return brandless && brandless !== alias ? brandless : undefined;
}

function resolveSafeShortAlias(alias: string): string | undefined {
  if (!STORE_SUFFIX.test(alias)) {
    return undefined;
  }
  const stripped = alias.replace(STORE_SUFFIX, "").trim();
  return Array.from(stripped).length >= MIN_SAFE_SHORT_ALIAS_CHARS ? stripped : undefined;
}

export function resolveStoreAliasCandidates(
  store: Pick<HetangStoreConfig, "storeName" | "rawAliases">,
): string[] {
  const rawCandidates = [store.storeName, ...(store.rawAliases ?? [])].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  const expanded: string[] = [];
  for (const alias of rawCandidates) {
    const trimmed = alias.trim();
    expanded.push(trimmed);

    const brandless = resolveStoreBrandlessAlias(trimmed);
    if (brandless) {
      expanded.push(brandless);
      const shortBrandless = resolveSafeShortAlias(brandless);
      if (shortBrandless) {
        expanded.push(shortBrandless);
      }
      continue;
    }

    const shortAlias = resolveSafeShortAlias(trimmed);
    if (shortAlias) {
      expanded.push(shortAlias);
    }
  }
  return dedupeAliases(expanded);
}

export function resolveMatchedStores(
  config: HetangOpsConfig,
  text: string,
): HetangStoreAliasMatch[] {
  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    return [];
  }

  const matches = config.stores
    .map((store) => {
      const found = resolveStoreAliasCandidates(store)
        .map((alias) => {
          const normalizedAlias = normalizeText(alias);
          return {
            alias,
            position: normalizedText.indexOf(normalizedAlias),
            aliasLength: normalizedAlias.length,
          };
        })
        .filter((entry) => entry.position >= 0)
        .sort(
          (left, right) =>
            left.position - right.position || right.aliasLength - left.aliasLength,
        )[0];
      return found
        ? {
            orgId: store.orgId,
            storeName: store.storeName,
            matchedAlias: found.alias,
            position: found.position,
            aliasLength: found.aliasLength,
          }
        : null;
    })
    .filter((entry): entry is HetangStoreAliasMatch => Boolean(entry))
    .sort(
      (left, right) =>
        left.position - right.position || right.aliasLength - left.aliasLength,
    );

  const seen = new Set<string>();
  const ordered: HetangStoreAliasMatch[] = [];
  for (const match of matches) {
    if (seen.has(match.orgId)) {
      continue;
    }
    seen.add(match.orgId);
    ordered.push(match);
  }
  return ordered;
}

export function resolveFirstMatchedStoreName(
  config: HetangOpsConfig,
  text: string,
): string | undefined {
  return resolveMatchedStores(config, text)[0]?.storeName;
}

export function mentionsConfiguredStore(config: HetangOpsConfig, text: string): boolean {
  return resolveMatchedStores(config, text).length > 0;
}
