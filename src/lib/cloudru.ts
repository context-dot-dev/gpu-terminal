import type { Rate } from "./types";

export const cloudRuNoRatesReason =
  "Cloud.ru publishes V100 virtual-machine and V100/A100/H100 ML-service prices, but does not state per-GPU pricing or a GPU count for those configurations. Its 8×H100 dedicated-server quote is monthly. No comparable per-GPU hourly rate can be derived without guessing or converting the monthly price.";

export function parseCloudRu(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  if (
    !Number.isFinite(Date.parse(observedAt)) ||
    !sourceUrl.startsWith("https://cloud.ru/") ||
    !markdown.includes("Стоимость вычислительных мощностей с GPU") ||
    !markdown.includes("Цена (с НДС)")
  )
    throw new Error("Source Cloud.ru GPU pricing section, URL or observation is missing");

  const expectedEvidence = [
    /V100\s+от\s+[\d\s\u00a0\u202f,.]+\s*руб\s*за\s*час/i,
    /V100\s+от\s+[\d\s\u00a0\u202f,.]+\s*руб\s*за\s*минуту/i,
    /A100\s+от\s+[\d\s\u00a0\u202f,.]+\s*руб\s*за\s*минуту/i,
    /H100\s+от\s+[\d\s\u00a0\u202f,.]+\s*руб\s*за\s*минуту/i,
  ];
  if (
    expectedEvidence.some((pattern) => !pattern.test(markdown)) ||
    !markdown.includes("HGX (8xH100 80GB)") ||
    !/От\s+[\d\s\u00a0\u202f,.]+\s+руб\.\s+в\s+месяц/i.test(markdown)
  )
    throw new Error("Source Cloud.ru published GPU prices changed or are incomplete");

  return [];
}
