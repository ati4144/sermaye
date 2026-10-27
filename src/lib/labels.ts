import type { TFunction } from 'i18next';
import { ASSET_IDS, COUNTRY_IDS } from '@/engine';

/**
 * Resolve a market id (country or asset) to its localized display name.
 * Asset-scope events reuse PendingEvent.countryId for the asset id, so every
 * id-bearing surface goes through here.
 */
export function marketName(t: TFunction, id: string | undefined): string | undefined {
  if (!id) return undefined;
  if (COUNTRY_IDS.includes(id)) return t(`countries.${id}.name`);
  if (ASSET_IDS.includes(id)) return t(`assets.${id}.name`);
  return id;
}
