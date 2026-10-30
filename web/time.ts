function partsAt(ms: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ms);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}`;
}
export function unitInstant(local: string, timezone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new Error("Informe data e hora completas.");
  const target = Date.parse(local + ":00Z");
  let instant = target;
  for (let i = 0; i < 4; i++) {
    const rendered = Date.parse(partsAt(instant, timezone) + ":00Z");
    instant += target - rendered;
  }
  if (partsAt(instant, timezone) !== local)
    throw new Error("Horário inexistente nesse fuso. Confira a data e a hora.");
  if (
    partsAt(instant - 3600000, timezone) === local ||
    partsAt(instant + 3600000, timezone) === local
  )
    throw new Error(
      "Horário ambíguo por mudança de fuso. Escolha um horário fora da transição.",
    );
  return new Date(instant).toISOString();
}
export function unitLocal(iso: string, timezone: string) {
  return partsAt(Date.parse(iso), timezone);
}
