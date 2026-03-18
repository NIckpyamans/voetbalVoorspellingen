export default async function handler(req: any, res: any) {
  const id = (req.query.id || req.query.teamId) as string;
  if (!id || !/^\d+$/.test(id)) {
    return res.status(400).end();
  }

  const candidates = [
    `https://api.sofascore.app/api/v1/team/${id}/image`,
    `https://api.sofascore.com/api/v1/team/${id}/image`,
  ];

  for (const url of candidates) {
    try {
      const upstream = await fetch(url, {
        headers: {
          Accept: "image/png,image/webp,image/*",
          Origin: "https://www.sofascore.com",
          Referer: "https://www.sofascore.com/",
          "User-Agent": "Mozilla/5.0",
        },
      });

      if (!upstream.ok) continue;

      const contentType = upstream.headers.get("content-type") || "image/png";
      const buffer = await upstream.arrayBuffer();

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).send(Buffer.from(buffer));
    } catch {}
  }

  return res.status(404).end();
}
