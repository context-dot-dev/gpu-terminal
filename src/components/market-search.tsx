"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { ProviderLogo } from "@/components/provider-logo";
import { gpuFamily } from "@/lib/gpu-family";
import { providers } from "@/lib/catalog";
import type { Rate } from "@/lib/types";

type MarketTab = "explore" | "saved" | "coverage";

export function MarketSearch({
  rates,
  onSearch,
  onProvider,
  onGpu,
  onNavigate,
}: {
  rates: Rate[];
  onSearch: (query: string) => void;
  onProvider: (id: string) => void;
  onGpu: (family: string) => void;
  onNavigate: (tab: MarketTab) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const gpuFamilies = useMemo(() => {
    const discovered = rates.map((rate) => gpuFamily(rate.gpu));
    return [...new Set([...COMMON_GPU_FAMILIES, ...discovered])].sort();
  }, [rates]);
  const visibleProviders = query.trim() ? providers : providers.slice(0, 6);
  const visibleGpuFamilies = query.trim() ? gpuFamilies : POPULAR_GPU_FAMILIES;

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function search(queryText: string) {
    const normalized = queryText.trim();
    if (!normalized) return;
    onSearch(normalized);
    close();
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label="Search GPUs, providers…"
        className="masthead-search h-9 justify-start gap-2 border-transparent bg-transparent px-3 text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">
          Search
        </span>
        <CommandShortcut className="ml-auto hidden rounded border px-1.5 py-0.5 font-sans text-[10px] sm:inline-flex">
          ⌘K
        </CommandShortcut>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
        title="Search GPUs and providers"
        description="Search GPU offers, providers, and dashboard sections."
        className="top-[20%] max-w-xl translate-y-0"
      >
        <Command
          shouldFilter
          className="rounded-xl bg-popover p-1 text-popover-foreground"
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search GPUs, providers, or enter a query…"
            aria-label="Search GPUs, providers, or enter a query"
          />
          <CommandList className="max-h-[min(60dvh,28rem)]">
            <CommandEmpty>
              <Button
                type="button"
                variant="ghost"
                onClick={() => search(query)}
              >
                Search for “{query.trim()}”
              </Button>
            </CommandEmpty>

            {query.trim() ? (
              <CommandGroup heading="Search">
                <CommandItem
                  value={`search ${query}`}
                  onSelect={() => search(query)}
                >
                  <Search aria-hidden="true" />
                  Search for “{query.trim()}”
                  <CommandShortcut>↵</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            ) : null}

            <CommandGroup heading="GPU families">
              {visibleGpuFamilies.map((family) => (
                <CommandItem
                  key={family}
                  value={`${family} GPU graphics processor`}
                  onSelect={() => {
                    onGpu(family);
                    close();
                  }}
                >
                  <span className="flex size-6 items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground">
                    GPU
                  </span>
                  <span>{family}</span>
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandGroup heading="Navigate">
              {NAVIGATION.map(({ label, tab }) => (
                <CommandItem
                  key={tab}
                  value={`${label} ${tab} page`}
                  onSelect={() => {
                    onNavigate(tab);
                    close();
                  }}
                >
                  <span>{label}</span>
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandGroup heading="Providers">
              {visibleProviders.map((provider) => (
                <CommandItem
                  key={provider.id}
                  value={`${provider.name} ${provider.id} ${(provider.aliases ?? []).join(" ")} provider`}
                  onSelect={() => {
                    onProvider(provider.id);
                    close();
                  }}
                >
                  <ProviderLogo providerId={provider.id} />
                  <span>{provider.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

const NAVIGATION: { label: string; tab: MarketTab }[] = [
  { label: "Explore", tab: "explore" },
  { label: "Saved", tab: "saved" },
  { label: "Coverage", tab: "coverage" },
];

const COMMON_GPU_FAMILIES = [
  "A100",
  "B200",
  "H100",
  "H200",
  "L4",
  "L40S",
  "MI300X",
  "RTX 4090",
  "RTX 5090",
];

const POPULAR_GPU_FAMILIES = [
  "H100",
  "H200",
  "B200",
  "A100",
  "RTX 4090",
  "RTX 5090",
];
