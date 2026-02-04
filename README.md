<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1flTlewPJ1rfoPRvL7a_rL_U48tuFpRla

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

## Notes

- **No API keys needed.** Match data is pulled from a public (unofficial) SofaScore JSON feed.
- Predictions run **fully locally** (Elo + Poisson) and the model **learns in your browser** by storing finished results in `localStorage`.

Server-side learning (optional):
- A simple server-side worker and GitHub Action were added to allow scheduled learning and predictions stored in `server_data.json`.
- The app exposes a serverless endpoint at `/api/predict?date=YYYY-MM-DD` which returns server predictions when available.

Deploy to Vercel (quick):
1. Push your repo to GitHub.
2. Go to https://vercel.com and import the repo (or run `vercel` via CLI).
3. Ensure the GitHub Action `Server-side learning` is enabled in `.github/workflows/learn.yml` to run hourly and update `server_data.json` with new predictions.

