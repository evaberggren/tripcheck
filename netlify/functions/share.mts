import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const STORE_NAME = "triplens-shares";
const MAX_PAYLOAD_BYTES = 48 * 1024; // 48KB is plenty for a result object

function makeShareId() {
  // 10 chars, url-safe, lowercase letters + digits — quiet and premium.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 10);
}

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const store = getStore(STORE_NAME);

  if (req.method === "POST") {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const payload = body as { trip?: unknown; result?: unknown };
    if (!payload || typeof payload !== "object" || !payload.trip || !payload.result) {
      return Response.json({ error: "Missing trip or result" }, { status: 400 });
    }

    const serialized = JSON.stringify({
      trip: payload.trip,
      result: payload.result,
      createdAt: new Date().toISOString(),
    });

    if (serialized.length > MAX_PAYLOAD_BYTES) {
      return Response.json({ error: "Payload too large" }, { status: 413 });
    }

    const id = makeShareId();
    try {
      await store.set(id, serialized);
    } catch (err) {
      console.error("share save failed", err);
      return Response.json({ error: "Could not save share" }, { status: 502 });
    }

    return Response.json({ id }, { headers: { "Cache-Control": "no-store" } });
  }

  if (req.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id || !/^[a-z0-9]{6,16}$/.test(id)) {
      return Response.json({ error: "Invalid share id" }, { status: 400 });
    }
    try {
      const data = await store.get(id, { type: "json" });
      if (!data) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json(data, {
        headers: { "Cache-Control": "public, max-age=300" },
      });
    } catch (err) {
      console.error("share load failed", err);
      return Response.json({ error: "Could not load share" }, { status: 502 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = {
  path: "/.netlify/functions/share",
};
