import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { offerCharacteristics } from "@/lib/offer-characteristics";
import type { Rate } from "@/lib/types";

export function OfferCaveats({
  rate,
  compact = false,
}: {
  rate: Rate;
  compact?: boolean;
}) {
  const traits = offerCharacteristics(rate);
  const labels = [
    traits.supply === "Community" ? "Community" : null,
    traits.interruptible ? "Interruptible" : null,
    traits.priority !== "Not specified" ? `${traits.priority} priority` : null,
    !compact && traits.execution !== "Not specified" ? traits.execution : null,
    !compact && traits.ephemeral ? "Ephemeral local storage" : null,
  ].filter(Boolean);
  if (!labels.length) return null;
  if (compact)
    return (
      <span className="mt-1 flex flex-wrap gap-1" data-testid="offer-caveats">
        {labels.map((label) => (
          <Badge
            key={label}
            variant="outline"
            className="text-[10px] font-normal"
          >
            {label}
          </Badge>
        ))}
      </span>
    );
  return (
    <div className="space-y-2" data-testid="offer-caveats">
      <div className="mt-1 flex flex-wrap gap-1">
        {labels.map((label) => (
          <Badge
            key={label}
            variant="outline"
            className="text-[10px] font-normal"
          >
            {label}
          </Badge>
        ))}
      </div>
      {!compact && (
        <>
          {traits.caveats.map((caveat) => (
            <p key={caveat} className="text-xs text-muted-foreground">
              {caveat}
            </p>
          ))}
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {traits.sources.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({
                  variant: "link",
                  className: "h-auto p-0 text-xs whitespace-normal",
                })}
              >
                {source.label} ↗
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
