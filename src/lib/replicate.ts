import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseReplicate(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  if (!Number.isFinite(Date.parse(observedAt)))
    throw new Error("Source Replicate observation time is invalid");
  const header = "| Hardware | Price | GPU | CPU | GPU RAM | RAM |";
  const start = markdown.indexOf(header);
  if (start < 0)
    throw new Error("Source Replicate hardware table header is missing");
  const lines = markdown.slice(start).split("\n");
  const rates: Rate[] = [];
  const identities = new Set<string>();
  for (const row of lines.slice(2)) {
    if (!row.startsWith("|")) break;
    const cells = row
      .slice(1, -1)
      .split("|")
      .map((s) => s.trim());
    if (cells[0] === "Additional hardware" || /^CPU(?:\b|<)/.test(cells[0]))
      continue;
    const hardware =
      /^(?:([1-9]\d*)x )?Nvidia ([A-Z0-9]+)(?: \(\d+GB\))? GPU<br>(gpu-[a-z0-9-]+)$/.exec(
        cells[0],
      );
    const price = /^\$(\d+(?:\.\d+)?)\/sec<br>\$(\d+(?:\.\d+)?)\/hr$/.exec(
      cells[1],
    );
    if (!hardware || !price)
      throw new Error("Source Replicate hardware or price format changed");
    const count = Number(hardware[1] ?? 1),
      amount = Number(price[1]);
    if (!(amount > 0) || Math.abs(amount * 3600 - Number(price[2])) > 0.005)
      throw new Error(
        "Source Replicate second and hourly instance prices disagree",
      );
    const contracted =
      cells.length === 3 &&
      /capacity is available with committed spend contracts\.$/.test(cells[2]);
    let vram: number | null = null,
      cpus: number | null = null,
      ram: number | null = null;
    if (!contracted) {
      if (
        cells.length !== 6 ||
        cells[2] !== `${count}x` ||
        !/^\d+x$/.test(cells[3]) ||
        !/^\d+GB$/.test(cells[4]) ||
        !/^\d+GB$/.test(cells[5])
      )
        throw new Error(
          "Source Replicate GPU count or resource columns are ambiguous",
        );
      cpus = parseInt(cells[3]);
      vram = parseInt(cells[4]) / count;
      ram = parseInt(cells[5]);
    }
    const billing = contracted ? "Committed" : "Serverless";
    const plan = hardware[3];
    if (identities.has(plan))
      throw new Error("Source Replicate repeats a hardware SKU");
    identities.add(plan);
    rates.push({
      id: createHash("sha256")
        .update(
          JSON.stringify([
            "replicate",
            plan,
            billing,
            "USD",
            "instance-second",
          ]),
        )
        .digest("hex")
        .slice(0, 24),
      providerId: "replicate",
      gpu: hardware[2],
      gpuCount: count,
      vramGb: vram,
      vcpus: cpus,
      ramGb: ram,
      plan,
      billing,
      commitment: contracted
        ? "Committed spend contract; term not published"
        : "None",
      currency: "USD",
      amount,
      unit: "instance-second",
      hourly: Math.round(((amount * 3600) / count) * 1e8) / 1e8,
      region: "Not specified",
      priceType: "Exact",
      availability: "Not verified",
      collectionMethod: "Table parser",
      evidence: `${header}\n${row}`,
      notes: `Published price is per second for the entire hardware instance. Public models charge processing time; most private models also charge setup and idle time.${contracted ? " Capacity requires a committed spend contract; term is not published." : ""} Capacity is not verified.`,
      sourceUrl,
      observedAt,
    });
  }
  if (!rates.length)
    throw new Error("Source Replicate has no validated GPU hardware rates");
  return rates;
}
