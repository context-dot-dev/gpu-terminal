import { providers } from "./catalog";

const providerIds = new Set(providers.map((provider) => provider.id));

export function providerLogoUrl(providerId: string): string | undefined {
  return providerIds.has(providerId)
    ? `/provider-logos/${providerId}.webp`
    : undefined;
}
