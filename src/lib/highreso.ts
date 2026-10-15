import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseHighreso(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  if (!Number.isFinite(Date.parse(observedAt)))
    throw new Error("Source Highreso observation time is invalid");
  const start = markdown.indexOf("## 高速コンピューティングの料金プラン");
  const end = markdown.indexOf("\nスクロールできます", start);
  if (start < 0 || end < 0)
    throw new Error("Source Highreso own pricing table is missing");
  const table = markdown.slice(start, end);
  const raw = [...table.matchAll(/^\|[\s\S]*?(?=^\||$(?![\s\S]))/gm)].map((m) =>
    m[0].trim(),
  );
  const rows = raw.map((r) =>
    r
      .slice(1, -1)
      .split("|")
      .map((c) => c.replace(/\*\*/g, "").replace(/\s+/g, " ").trim()),
  );
  const header = rows.find((r) => r[0] === "インスタンス ファミリー");
  const hourly = rows.find(
    (r) => r[0].startsWith("従量課金の場合") && r[0].includes("1h・台"),
  );
  const gpu = rows.find((r) => r[0] === "GPU"),
    memory = rows.find((r) => r[0] === "GPUメモリ"),
    cpu = rows.find((r) => r[0] === "vCPU"),
    ram = rows.find((r) => r[0] === "システムメモリ");
  if (
    !header ||
    !hourly ||
    !gpu ||
    !memory ||
    !cpu ||
    !ram ||
    [hourly, gpu, memory, cpu, ram].some((r) => r.length !== header.length)
  )
    throw new Error(
      "Source Highreso transposed pricing columns are not aligned",
    );
  const rates: Rate[] = [];
  for (let i = 1; i < header.length; i++) {
    if (/^\\?-$/.test(hourly[i])) continue;
    const price = /^￥(\d+(?:,\d{3})*)$/.exec(hourly[i]);
    const hardware = /^NVIDIA (A4000|A100) (\d+)GBx(\d+)枚$/.exec(gpu[i]);
    const totalMemory = /^(\d+)GB$/.exec(memory[i]),
      cpus = /^(\d+)コア(?:\(物理コア\))?$/.exec(cpu[i]),
      hostRam = /^(\d+)(GB|TB)$/.exec(ram[i]);
    if (!price || !hardware || !totalMemory || !cpus || !hostRam)
      throw new Error(
        "Source Highreso hourly hardware configuration is not unambiguous",
      );
    const amount = Number(price[1].replace(/,/g, "")),
      gpuCount = Number(hardware[3]),
      vramGb = Number(hardware[2]);
    if (!(amount > 0) || Number(totalMemory[1]) !== vramGb * gpuCount)
      throw new Error("Source Highreso aggregate and per-card memory disagree");
    const plan = header[i];
    rates.push({
      id: createHash("sha256")
        .update(
          JSON.stringify([
            "highreso",
            plan,
            "JPY",
            "instance-hour",
            "On-demand",
          ]),
        )
        .digest("hex")
        .slice(0, 24),
      providerId: "highreso",
      gpu: hardware[1],
      gpuCount,
      vramGb,
      vcpus: Number(cpus[1]),
      ramGb: hostRam[2] === "GB" ? Number(hostRam[1]) : null,
      plan,
      region: "Not specified",
      billing: "On-demand",
      commitment: "None",
      currency: "JPY",
      amount,
      unit: "instance-hour",
      hourly: Math.round((amount / gpuCount) * 1e8) / 1e8,
      priceType: "Exact",
      availability: "Not verified",
      collectionMethod: "Table parser",
      evidence: table,
      notes:
        "Published Japanese yen pay-as-you-go price per instance-hour (1h・台). Consumption tax, standard storage and data transfer included; larger storage extra. Charges stop when the instance is stopped. Historical competitor comparisons and monthly-only multi-GPU configurations excluded; capacity not verified.",
      sourceUrl,
      observedAt,
    });
  }
  if (rates.length !== 3)
    throw new Error(
      "Source Highreso expected three priced hourly configurations",
    );
  return rates;
}
