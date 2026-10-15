import { createHash } from "node:crypto";
import type { Rate } from "./types";

const SOURCE =
  "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/us-east-1/index.csv";
const SPECS =
  "https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-gpu.html";
const MODELS = "https://docs.aws.amazon.com/dlami/latest/devguide/gpu.html";
const MAX_BYTES = 400_000_000;
const hardware: Record<string, { gpu: string; count: number; memory: number }> =
  {};
for (const [family, gpu, memory] of [
  ["g5", "NVIDIA A10G", 24],
  ["g6", "NVIDIA L4", 24],
  ["g6e", "NVIDIA L40S", 48],
] as const) {
  for (const size of ["xlarge", "2xlarge", "4xlarge", "8xlarge", "16xlarge"])
    hardware[`${family}.${size}`] = { gpu, count: 1, memory };
  for (const size of ["12xlarge", "24xlarge"])
    hardware[`${family}.${size}`] = { gpu, count: 4, memory };
  hardware[`${family}.48xlarge`] = { gpu, count: 8, memory };
}
hardware["p4d.24xlarge"] = { gpu: "NVIDIA A100 40GB", count: 8, memory: 40 };
hardware["p5.48xlarge"] = { gpu: "NVIDIA H100 80GB", count: 8, memory: 80 };

function csvRow(line: string): string[] {
  const fields: string[] = [];
  let field = "",
    quoted = false;
  for (let i = 0; i < line.length; i++) {
    const character = line[i];
    if (character === '"') {
      if (quoted && line[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      fields.push(field);
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("AWS price feed has an incomplete CSV record");
  fields.push(field);
  return fields;
}

export async function collectAws(): Promise<{
  rates: Rate[];
  document: string;
  sourceUrl: string;
}> {
  const response = await fetch(SOURCE, {
    cache: "no-store",
    signal: AbortSignal.timeout(150_000),
    headers: { "Accept-Encoding": "identity" },
  });
  if (!response.ok || response.status !== 200 || !response.body)
    throw new Error(`AWS price feed HTTP ${response.status}`);
  const expectedBytes = Number(response.headers.get("content-length"));
  if (
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes <= 0 ||
    expectedBytes > MAX_BYTES ||
    response.headers.get("content-encoding")
  ) {
    await response.body.cancel();
    throw new Error(
      "AWS price feed has no verifiable uncompressed content length or exceeds 400 MB",
    );
  }
  const rates: Rate[] = [],
    ids = new Set<string>(),
    evidence: string[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0,
    buffer = "",
    lineNumber = 0,
    headers: string[] = [],
    publication = "";
  const observedAt = new Date().toISOString();
  const required = [
    "SKU",
    "TermType",
    "PriceDescription",
    "EffectiveDate",
    "StartingRange",
    "EndingRange",
    "Unit",
    "PricePerUnit",
    "Currency",
    "Product Family",
    "Instance Type",
    "Tenancy",
    "Operating System",
    "CapacityStatus",
    "Pre Installed S/W",
    "Region Code",
    "GPU",
    "operation",
  ];
  function consume(line: string) {
    if (!line) return;
    lineNumber++;
    if (lineNumber <= 5) {
      const metadata = csvRow(line);
      if (metadata[0] === "Publication Date") publication = metadata[1];
      if (
        lineNumber === 5 &&
        (metadata[0] !== "OfferCode" || metadata[1] !== "AmazonEC2")
      )
        throw new Error("AWS price feed metadata changed");
      return;
    }
    if (lineNumber === 6) {
      headers = csvRow(line);
      if (required.some((name) => !headers.includes(name)))
        throw new Error("AWS price feed is missing required columns");
      return;
    }
    if (!line.includes('"OnDemand"') || !/"(?:g5|g6|g6e|p4d|p5)\./.test(line))
      return;
    const values = csvRow(line);
    if (values.length !== headers.length)
      throw new Error("AWS price feed CSV columns do not match the header");
    const row = Object.fromEntries(
      headers.map((header, i) => [header, values[i]]),
    );
    const spec = hardware[row["Instance Type"]];
    if (
      !spec ||
      row.TermType !== "OnDemand" ||
      row["Product Family"] !== "Compute Instance" ||
      row["Region Code"] !== "us-east-1" ||
      row.Tenancy !== "Shared" ||
      row["Operating System"] !== "Linux" ||
      row["Pre Installed S/W"] !== "NA" ||
      row.CapacityStatus !== "Used" ||
      row.operation !== "RunInstances" ||
      row.Currency !== "USD" ||
      row.Unit !== "Hrs" ||
      row.StartingRange !== "0" ||
      row.EndingRange !== "Inf"
    )
      return;
    const amount = Number(row.PricePerUnit),
      effective = Date.parse(row.EffectiveDate);
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isFinite(effective) ||
      effective > Date.now() ||
      Number(row.GPU) !== spec.count
    )
      throw new Error(
        `AWS has invalid pricing or GPU count for ${row["Instance Type"]}`,
      );
    const id = createHash("sha256")
      .update(`aws:us-east-1:${row.SKU}`)
      .digest("hex")
      .slice(0, 24);
    if (ids.has(id))
      throw new Error(`AWS has duplicate on-demand pricing for ${row.SKU}`);
    ids.add(id);
    const proof = `${row.SKU} | ${row["Instance Type"]} | USD ${row.PricePerUnit}/instance-hour | ${row.GPU} GPUs | ${row.PriceDescription} | effective ${row.EffectiveDate}`;
    evidence.push(proof);
    rates.push({
      id,
      providerId: "aws",
      gpu: spec.gpu,
      vramGb: spec.memory,
      gpuCount: spec.count,
      region: "us-east-1",
      plan: `${row["Instance Type"]} · Linux · shared tenancy`,
      billing: "On-demand",
      currency: "USD",
      amount,
      unit: "instance-hour",
      hourly: amount / spec.count,
      priceType: "Exact",
      availability: "Not verified",
      evidence: proof,
      notes: `US East (N. Virginia) only. Full instance required; CPU and RAM included, EBS and transfer charges excluded. Published list price does not verify capacity or account quota. GPU specs: ${SPECS}; GPU models: ${MODELS}.`,
      sourceUrl: SOURCE,
      observedAt,
    });
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > expectedBytes || bytes > MAX_BYTES)
        throw new Error("AWS price feed exceeds expected content length");
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, end).replace(/\r$/, ""));
        buffer = buffer.slice(end + 1);
      }
      if (buffer.length > 100_000)
        throw new Error("AWS price feed contains an oversized CSV record");
    }
    buffer += decoder.decode();
    if (buffer) consume(buffer.replace(/\r$/, ""));
    if (
      bytes !== expectedBytes ||
      headers.length === 0 ||
      !Number.isFinite(Date.parse(publication)) ||
      rates.length === 0
    )
      throw new Error("AWS price feed was truncated, empty, or invalid");
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return {
    rates,
    sourceUrl: SOURCE,
    document: `AWS EC2 regional bulk price list. Region: us-east-1 only. Linux shared-tenancy on-demand; verified g5/g6/g6e, p4d.24xlarge and p5.48xlarge SKUs only. Published ${publication}; retrieved ${observedAt}. Entire ${bytes}-byte feed received and checked against Content-Length.\n${evidence.join("\n")}`,
  };
}
