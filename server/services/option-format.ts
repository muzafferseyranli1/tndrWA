import type { OrderItemOption } from "@prisma/client";
import { formatTRY } from "../../shared/money";

/** Kalemin seçimlerini okunur satırlara çevirir: "Acılı", "Büyük boy (+20,00 TL)". "Hiçbiri" gösterilmez. */
export function describeOptions(options: Pick<OrderItemOption, "choiceName" | "extraKurus">[]): string[] {
  return options.filter((o) => o.choiceName).map((o) => (o.extraKurus > 0 ? `${o.choiceName} (+${formatTRY(o.extraKurus)})` : o.choiceName));
}
