"use client";

import { ImageOff } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { providers } from "@/lib/catalog";
import { providerLogoUrl } from "@/lib/provider-logo";

export function ProviderLogo({ providerId }: { providerId: string }) {
  const name = providers.find((provider) => provider.id === providerId)?.name;
  return (
    <Avatar size="sm" data-testid="provider-logo" data-provider-id={providerId}>
      <AvatarImage
        src={providerLogoUrl(providerId)}
        alt={`${name ?? "Provider"} logo`}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="object-contain"
      />
      <AvatarFallback>
        <ImageOff className="size-3" aria-label="Logo unavailable" />
      </AvatarFallback>
    </Avatar>
  );
}
