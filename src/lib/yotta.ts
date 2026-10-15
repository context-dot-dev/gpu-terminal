import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseYotta(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  if (!Number.isFinite(Date.parse(observedAt)))
    throw new Error("Source Yotta observation time is invalid");
  const start = markdown.indexOf("| VM – 1 x H100 On Demand |");
  const footer = "| \\*Unit Rate: Per Hour, per Compute.";
  const end = markdown.indexOf(footer, start);
  if (start < 0 || end < 0)
    throw new Error(
      "Source Yotta on-demand per-compute hourly table is missing",
    );
  const table = markdown.slice(start, end);
  const rows = [
    ...table.matchAll(
      /^\| (VM – ([124]) x (H100|L40S) On Demand) \|([\s\S]*?)\| ₹ ([\d,]+) \|/gm,
    ),
  ];
  if (rows.length !== 5 || new Set(rows.map((r) => r[1])).size !== 5)
    throw new Error(
      "Source Yotta expected five distinct complete hourly configurations",
    );
  return rows.map((row) => {
    const spec = /GPU : (\d+) x Nvidia (H100 SXM|L40S) \((\d+) GB\)/.exec(
      row[4],
    );
    const cpu = /vCPU : (\d+)/.exec(row[4]),
      ram = /RAM : (\d+) GB/.exec(row[4]);
    if (
      !spec ||
      !cpu ||
      !ram ||
      spec[1] !== row[2] ||
      !spec[2].startsWith(row[3])
    )
      throw new Error(
        "Source Yotta resource columns disagree with configuration name",
      );
    const gpuCount = Number(spec[1]),
      amount = Number(row[5].replace(/,/g, ""));
    if (!(amount > 0))
      throw new Error("Source Yotta hourly amount must be positive");
    return {
      id: createHash("sha256")
        .update(
          JSON.stringify([
            "yottashakticloud",
            row[1],
            "INR",
            "instance-hour",
            "On-demand",
          ]),
        )
        .digest("hex")
        .slice(0, 24),
      providerId: "yottashakticloud",
      gpu: spec[2],
      gpuCount,
      vramGb: Number(spec[3]) / gpuCount,
      vcpus: Number(cpu[1]),
      ramGb: Number(ram[1]),
      plan: row[1],
      region: "Not specified",
      billing: "On-demand",
      commitment: "None",
      currency: "INR",
      amount,
      unit: "instance-hour",
      hourly: Math.round((amount / gpuCount) * 1e8) / 1e8,
      priceType: "Exact",
      availability: "Not verified",
      collectionMethod: "Table parser",
      evidence: `${row[0]}\n${footer}`,
      notes:
        "Published Indian rupee price per whole virtual machine per hour. GPU memory in the configuration is total memory, divided by the card count. Listed root disk and unlimited ingress/egress included. Monthly dedicated plans excluded. Tax treatment and capacity not verified.",
      sourceUrl,
      observedAt,
    } satisfies Rate;
  });
}
