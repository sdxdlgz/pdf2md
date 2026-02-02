This is a Next.js app that stores uploads in Vercel Blob and uses Mineru batch upload parsing (`/file-urls/batch`) to generate Markdown/JSON/DOCX.

## Getting Started

First, install deps and run the dev server:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Environment variables

- `MINERU_API_TOKEN` (required) — Mineru API token (`Authorization: Bearer <token>`)
- `BLOB_READ_WRITE_TOKEN` (required) — Vercel Blob token (used by `/api/blob/upload`)

For local dev, copy `web/.env.example` to `web/.env.local`.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

Set the Vercel project **Root Directory** to `web` (this repo is a mono-root with docs in the parent folder).

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
