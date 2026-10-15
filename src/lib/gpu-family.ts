export function gpuFamily(gpu: string): string {
  if (/\s(?:\/|OR)\s/i.test(gpu)) return "Other";
  const model = gpu
    .toUpperCase()
    .replace(/\b(?:NVIDIA|GEFORCE)\b\s*/g, "")
    .replace(/\bMAX\s*[- ]\s*Q\b/g, "MAXQ")
    .replace(/[_-]/g, " ")
    .replace(/(\d{4})(ADA|BLACKWELL|PRO|TI|SUPER|D)\b/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(PRO\s*\d{4}|\d{4}\s+(?:PRO|ADA|BLACKWELL))\b/, "RTX $1");
  const rtx = model.match(
    /\bRTX\s*(PRO\s*|A\s*)?(\d{4})\s*(TI|SUPER|PRO|D|S)?\b/,
  );
  if (rtx) {
    const prefix = rtx[1]?.trim() ?? "";
    const pro = prefix === "PRO" || rtx[3] === "PRO";
    const number = rtx[2];
    const suffix = `${rtx[3] ?? ""} ${model.slice(rtx.index! + rtx[0].length)}`;
    const consumer =
      !pro &&
      !prefix &&
      /^(?:20[678]0|30[56789]0|40[56789]0|50[56789]0)$/.test(number);
    const generation = consumer
      ? ""
      : model.match(/\b(?:ADA|BLACKWELL)\b/)?.[0];
    const product = /\b(?:SERVER|SE)\b/.test(suffix)
      ? "SERVER"
      : /\b(?:WORKSTATION|WS)\b/.test(suffix)
        ? "WORKSTATION"
        : "";
    return [
      "RTX",
      pro ? "PRO" : "",
      prefix === "A" ? `A${number}` : number,
      /\bSFF\b/.test(suffix) ? "SFF" : "",
      generation,
      /\bD\b/.test(suffix) ? "D" : "",
      /\bTI\b/.test(suffix) ? "TI" : "",
      /\bSUPER\b/.test(suffix) || (consumer && /\bS\b/.test(suffix))
        ? "SUPER"
        : "",
      /\b(?:LAPTOP|MOBILE)\b/.test(suffix) ? "LAPTOP" : "",
      /\bMAXQ\b/.test(suffix) ? "MAX-Q" : "",
      product,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (/\bA6000\b/.test(model)) return "RTX A6000";
  return (
    model.match(
      /\b(?:G[HB]\d{3}|[ABH]\d{3}|A(?:4000|5000|10G?|30|40)|MI\d{3}X?|L40S?|L4|T4|V100|P100|P6000)\b/,
    )?.[0] ?? "Other"
  );
}
