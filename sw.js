// sw.js
// Stitches Track 01 split parts into a virtual Track 01.bin for the emulator.

const CACHE_NAME = "croc-track01-cache-v1";

const TRACK01_VIRTUAL = "Croc - Legend of the Gobbos (Europe) (Track 01).bin";

const TRACK01_PARTS = [
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.001",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.002",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.003",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.004",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.005",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.006",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.007",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.008",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.009",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.010",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.011"
];

function fileNameFromUrl(url) {
  try {
    const u = new URL(url);
    const name = u.pathname.split("/").pop();
    return decodeURIComponent(name || "");
  } catch {
    return "";
  }
}

async function fromCacheOrNet(url) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(url);
  if (hit) return hit;
  return fetch(url);
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const name = fileNameFromUrl(event.request.url);
  if (name !== TRACK01_VIRTUAL) return;

  event.respondWith((async () => {
    // Stream concatenation of all parts (200 OK full file)
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (const part of TRACK01_PARTS) {
            const resp = await fromCacheOrNet(part);
            if (!resp.ok) throw new Error("Missing part: " + part);

            if (!resp.body) {
              controller.enqueue(new Uint8Array(await resp.arrayBuffer()));
              continue;
            }

            const reader = resp.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store"
      }
    });
  })());
});