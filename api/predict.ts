import fs from 'fs';
import path from 'path';

const DATA_FILE = path.resolve(process.cwd(), 'server_data.json');

export default async function handler(req: any, res: any) {
  try {
    const date = (req.query?.date as string) || new Date().toISOString().split('T')[0];
    const raw = fs.existsSync(DATA_FILE) ? fs.readFileSync(DATA_FILE, 'utf-8') : null;
    const store = raw ? JSON.parse(raw) : { teams: {}, memory: [], predictions: {} };

    // If we already have predictions for the date, return them.
    if (store.predictions && store.predictions[date]) {
      return res.status(200).json({ date, predictions: store.predictions[date], source: 'server-data' });
    }

    // Otherwise return an empty payload and signal client to fallback to client-side predictions.
    return res.status(200).json({ date, predictions: [], source: 'none' });
  } catch (err: any) {
    console.error('predict api error', err);
    res.status(500).json({ error: err?.message || 'unknown' });
  }
}
