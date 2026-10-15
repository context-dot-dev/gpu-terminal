import type { Rate } from "./types";

export function parseGpuRentHub(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  if (!Number.isFinite(Date.parse(observedAt)))
    throw new Error("Source GPU Rent Hub observation time is invalid");
  if (new URL(sourceUrl).origin !== "https://gpurenthub.com")
    throw new Error("Source GPU Rent Hub URL is not canonical");

  const start = markdown.indexOf("## The fleet and today's monthly prices");
  const end = markdown.indexOf("\nPrices in USD, billed up front in crypto.", start);
  if (
    start < 0 ||
    end < 0 ||
    !markdown.includes("### Weekly & monthly terms") ||
    !/which is \$[\d,.]+ per GPU-hour if you keep it busy for all \d+ of them/.test(
      markdown,
    )
  )
    throw new Error("Source GPU Rent Hub weekly/monthly catalogue or billing proof changed");

  const section = markdown.slice(start, end);
  const lines = section.split("\n");
  const tableStart = lines.findIndex((line) =>
    line.startsWith("| GPU | VRAM | vCPU | RAM | NVMe | Weekly | Monthly | Availability |"),
  );
  if (tableStart < 0 || lines[tableStart + 1]?.trim() !== "| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    throw new Error("Source GPU Rent Hub pricing table headers changed");

  const rows = lines
    .slice(tableStart + 2)
    .filter((line) => line.startsWith("|"))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
  if (!rows.length)
    throw new Error("Source GPU Rent Hub weekly/monthly GPU rows are missing");

  for (const cells of rows) {
    if (cells.length !== 9)
      throw new Error("Source GPU Rent Hub pricing columns are not aligned");
    const label = /^\[([^\]]+)\]\([^)]+\)/.exec(cells[0])?.[1];
    const hardware = /NVIDIA(?: GeForce)?\s+(.+?)(?:\s+\d+\s*GB)?$/i.exec(cells[0]);
    const vram = /^(\d+)\s+GB\b/.exec(cells[1]);
    const cpus = /^(\d+)$/.exec(cells[2]);
    const ram = /^(\d+)\s+GB\b/.exec(cells[3]);
    const weekly = /^\$(\d[0-9,]*)\/wk$/.exec(cells[5]);
    const monthly = /^\$(\d[0-9,]*)\/mo$/.exec(cells[6]);
    const inventory = /^(\d+)\s+(?:left|available)$/.exec(cells[7]);
    if (
      !label ||
      !hardware ||
      !vram ||
      !cpus ||
      !ram ||
      !weekly ||
      !monthly ||
      !inventory ||
      Number(vram[1]) <= 0 ||
      Number(cpus[1]) <= 0 ||
      Number(ram[1]) <= 0 ||
      Number(weekly[1].replaceAll(",", "")) <= 0 ||
      Number(monthly[1].replaceAll(",", "")) <= 0 ||
      Number(inventory[1]) < 0 ||
      !hardware[1].toLowerCase().startsWith(label.toLowerCase())
    )
      throw new Error("Source GPU Rent Hub weekly/monthly offer is ambiguous");
  }

  // This source sells week- and month-long terms. Its GPU-hour example is
  // arithmetic derived from a monthly charge, not a GPU-hour billing option.
  return [];
}
