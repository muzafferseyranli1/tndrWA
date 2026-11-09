import dns from "node:dns";

/**
 * DNS dayanıklılığı: sunucunun (Docker) ad çözümleyicisi ara ara yanıt vermediğinde (EAI_AGAIN) Meta'ya giden
 * istekler düşüyordu. Her başarılı çözümleme hafızada tutulur; çözümleme geçici olarak başarısız olursa son bilinen
 * adres kullanılır. Ayrıca IPv4 öncelikli çözülür.
 * Node'un fetch/net katmanı bağlanırken dns.lookup'ı çağırdığı için burada sarmalanır (uygulama açılışında bir kez).
 */
type Addr = { address: string; family: number };
const TRANSIENT = new Set(["EAI_AGAIN", "ENOTFOUND", "ETIMEOUT", "ESERVFAIL", "ECONNREFUSED"]);
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

let installed = false;

export function installDnsCache(): void {
  if (installed) return;
  installed = true;
  dns.setDefaultResultOrder("ipv4first");
  const original = dns.lookup.bind(dns) as (...args: unknown[]) => void;
  const cache = new Map<string, { at: number; all: Addr[] }>();

  const patched = (hostname: string, options: unknown, callback?: unknown) => {
    let opts: { all?: boolean; family?: number | string } = {};
    let cb = callback as (err: NodeJS.ErrnoException | null, address?: string | Addr[], family?: number) => void;
    if (typeof options === "function") cb = options as typeof cb;
    else if (typeof options === "number") opts = { family: options };
    else if (options && typeof options === "object") opts = options as typeof opts;

    original(hostname, { ...opts, all: true }, (err: NodeJS.ErrnoException | null, addrs: Addr[]) => {
      if (!err && addrs?.length) {
        cache.set(hostname, { at: Date.now(), all: addrs });
        return opts.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family);
      }
      const hit = cache.get(hostname);
      if (err && TRANSIENT.has(err.code ?? "") && hit && Date.now() - hit.at < MAX_AGE_MS) {
        return opts.all ? cb(null, hit.all) : cb(null, hit.all[0].address, hit.all[0].family);
      }
      cb(err ?? Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }));
    });
  };
  (dns as unknown as { lookup: unknown }).lookup = patched;
}
