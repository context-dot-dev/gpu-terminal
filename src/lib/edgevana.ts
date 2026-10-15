import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseEdgevana(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  const count = markdown.match(/(\d+) of (\d+) configurations/);
  const cards = [
    ...markdown.matchAll(
      /Edgevana (Cloud GPU|Bare Metal GPU)\n\n([\s\S]*?)\n\n(Configure & Deploy|Reserve)(?=\n|$)/g,
    ),
  ];
  if (
    !Number.isFinite(Date.parse(observedAt)) ||
    !count ||
    Number(count[1]) !== Number(count[2]) ||
    cards.length !== Number(count[1]) ||
    !cards.length
  )
    throw new Error(
      "Edgevana configuration list is incomplete or its structure changed",
    );
  const configurations = new Map<string, { rate: Rate; offers: number }>();
  const number = (value: string) => Number(value.replaceAll(",", ""));
  for (const card of cards) {
    const [, kind, body, action] = card;
    const sku = body.split("\n")[0].trim();
    const model = body.match(/^GPU:(?:(\d+)× )?([^\n]+)$/m);
    const memory = body.match(/^([\d,.]+) GB VRAM$/m);
    const cpu = body.match(/^CPU:(\d+) Cores, (\d+) Threads([^\n]*)$/m);
    const ram = body.match(/^RAM:([\d,.]+) GB$/m);
    const storage = body.match(/^Storage:([^\n]+)$/m);
    const network = body.match(/^Network:([^\n]+)$/m)?.[1] ?? "Not specified";
    const prices = body.match(
      /^Starting at\$([\d,.]+)\/GPU\/hr\$([\d,.]+)\/hr total(?:≈|\n|$)/m,
    );
    const singlePrice = body.match(/^Starting at\$([\d,.]+)\/hr(?:≈|\n|$)/m);
    if (
      !/^(?:CLG|BM)-[A-Z0-9-]+$/.test(sku) ||
      !model ||
      !memory ||
      !cpu ||
      !ram ||
      !storage ||
      !body.includes("✓ Hourly Usage Billing") ||
      (!prices && !singlePrice)
    )
      throw new Error(
        `Edgevana card has an unrecognized resource or price unit: ${sku}`,
      );
    const gpuCount = model[1] ? Number(model[1]) : 1;
    const amount = number(prices ? prices[2] : singlePrice![1]);
    if (
      !Number.isSafeInteger(gpuCount) ||
      gpuCount < 1 ||
      gpuCount > 2048 ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      (!prices && gpuCount !== 1)
    )
      throw new Error(`Edgevana price or GPU count is invalid: ${sku}`);
    const hourly = amount / gpuCount;
    if (
      prices &&
      Math.abs(number(prices[1]) - hourly) > 0.005 + 0.005 / gpuCount + 1e-8
    )
      throw new Error(
        `Edgevana per-GPU and total prices disagree beyond displayed rounding: ${sku}`,
      );
    const ramGb = number(ram[1]),
      rawVram = number(memory[1]);
    if (
      !Number.isFinite(ramGb) ||
      ramGb <= 0 ||
      !Number.isFinite(rawVram) ||
      rawVram <= 0 ||
      Number(cpu[1]) < 1 ||
      Number(cpu[2]) < 1
    )
      throw new Error(`Edgevana hardware amounts are invalid: ${sku}`);
    const gpu = model[2]
      .trim()
      .replace(/\bRTXPRO(?=\d)/g, "RTX PRO ")
      .replace(/\bRTXA(?=\d)/g, "RTX A")
      .replace(/\bRTX(?=\d)/g, "RTX ")
      .replace(/(\d)(ADA|TI|LAPTOP)\b/g, "$1 $2");
    const id = createHash("sha256")
      .update(
        JSON.stringify([
          "edgevana-config-v1",
          kind,
          sku,
          model[2],
          gpuCount,
          rawVram,
          cpu[0],
          ramGb,
          storage[1],
          network,
          "USD",
          "instance-hour",
        ]),
      )
      .digest("hex")
      .slice(0, 24);
    const rate: Rate = {
      id,
      providerId: "edgevana",
      collectionMethod: "Table parser",
      gpu,
      gpuCount,
      vramGb: gpuCount === 1 ? rawVram : null,
      vcpus: null,
      ramGb,
      commitment: "Unknown",
      region: "Not specified",
      plan: `${kind} · ${sku} · ${cpu[1]} cores · ${ramGb} GB RAM · ${storage[1]}`,
      billing: "Unspecified",
      currency: "USD",
      amount,
      unit: "instance-hour",
      hourly,
      priceType: "Starting at",
      availability: "Not verified",
      sourceUrl,
      observedAt,
      evidence: `Edgevana ${kind}\n\n${body}\n\n${action}`,
      notes: `Published starting price; original instance total USD ${amount}/hour divided by ${gpuCount} GPU${gpuCount === 1 ? "" : "s"}. ${prices ? `The displayed per-GPU quote USD ${prices[1]}/hour is rounded.` : "Single-GPU hourly configuration."} Source states Hourly Usage Billing but no commitment or region. CPU specification: ${cpu[1]} cores, ${cpu[2]} threads${cpu[3] ? `, ${cpu[3]}` : ""}; these are not labeled vCPUs. ${gpuCount > 1 ? `VRAM label is ${rawVram} GB; the page mixes total and per-device VRAM, so per-GPU memory is unverified.` : `VRAM: ${rawVram} GB on this single GPU.`} Storage: ${storage[1]}. Network: ${network}. Action: ${action}. Availability is not verified: the source says live availability is still loading. Displayed monthly equivalents are not hourly billing terms.`,
    };
    const existing = configurations.get(id);
    if (!existing) configurations.set(id, { rate, offers: 1 });
    else {
      existing.offers++;
      if (rate.amount < existing.rate.amount) existing.rate = rate;
    }
  }
  return [...configurations.values()].map(({ rate, offers }) => ({
    ...rate,
    notes: `${rate.notes} ${offers > 1 ? `Lowest published starting price among ${offers} listings with identical published resource specifications.` : "One published resource configuration."} No unique host identifier is provided; history tracks the configuration's starting price, not a specific host.`,
  }));
}
