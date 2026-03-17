// api/logo.ts — proxyt clublogo's van SofaScore zodat CORS geen probleem is
export default async function handler(req: any, res: any) {
  const { id } = req.query;
  if (!id || typeof id !== 'string' || !/^\d+$/.test(id)) {
    return res.status(400).end();
  }

  try {
    const upstream = await fetch(
      `https://api.sofascore.app/api/v1/team/${id}/image`,
      {
        headers: {
          'Accept': 'image/png,image/webp,image/*',
          'Origin': 'https://www.sofascore.com',
          'Referer': 'https://www.sofascore.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/123.0',
        }
      }
    );

    if (!upstream.ok) {
      return res.status(404).end();
    }

    const contentType = upstream.headers.get('content-type') || 'image/png';
    const buffer = await upstream.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 uur cache
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).send(Buffer.from(buffer));

  } catch {
    return res.status(404).end();
  }
}
