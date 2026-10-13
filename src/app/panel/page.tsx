import { redirect } from "next/navigation";

/** Eski giriş sayfası: menü sadeleştirildi, panel doğrudan siparişlerle açılır. */
export default function PanelPage() {
  redirect("/orders");
}
