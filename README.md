# pdf2md (Mineru) on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fsdxdlgz%2Fpdf2md&root-directory=web&env=MINERU_API_TOKEN,BLOB_READ_WRITE_TOKEN)

This repo contains a Next.js app (in `web/`) that:

- Lets users upload one or more PDFs (stored in **Vercel Blob**)
- Uses Mineru “**文件批量上传解析**” flow (`/file-urls/batch` + PUT upload) to generate **Markdown / JSON / DOCX**
- Lets users download outputs with the **same base filename** as the input (only extension differs)

`mineru.txt` is ignored by git (keep your local notes there if you want).

## How it works (2 layers)

1. **Upload / Storage**: user uploads PDFs to Vercel Blob.
2. **Convert / Mineru**: server requests Mineru upload URLs and PUTs the stored PDFs to Mineru. Mineru auto-submits parsing after upload.

## Environment variables

Set these in **Vercel Project → Settings → Environment Variables** (and locally in `web/.env.local`):

- `MINERU_API_TOKEN` (required)
  - Get it from Mineru website (API Token).
  - Used as `Authorization: Bearer <token>` when calling Mineru APIs.
- `BLOB_READ_WRITE_TOKEN` (required)
  - In Vercel: go to **Project → Storage → Blob** and create/connect a Blob store, then create/copy a Read‑Write token.
  - Locally: copy the token into `web/.env.local`.

## Deploy to Vercel (manual)

1. Push this repo to GitHub (or use the button above).
2. In Vercel, import the repo.
3. Set **Root Directory** to `web`.
4. Add the environment variables above (Production + Preview + Development if you need).
5. Deploy.

## Local development

```bash
cd web
cp .env.example .env.local
# edit .env.local
pnpm install
pnpm dev
```

Open `http://localhost:3000`.
