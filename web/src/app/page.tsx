import MineruUploader from "@/app/components/MineruUploader";

export default function Home() {
  const donateUrl = (process.env.NEXT_PUBLIC_DONATE_URL || "").trim();
  const githubUrl = (process.env.NEXT_PUBLIC_GITHUB_URL || "").trim();

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <main className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">PDF2MD（Mineru API）</h1>
        </header>

        <MineruUploader />

        {donateUrl || githubUrl ? (
          <footer className="mt-10 border-t border-zinc-200 pt-6">
            <div className="flex items-center justify-center gap-4 text-sm">
              {donateUrl ? (
                <a
                  href={donateUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-zinc-700 hover:text-zinc-900"
                >
                  打赏一下！
                </a>
              ) : null}

              {githubUrl ? (
                <a
                  href={githubUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
                  title="GitHub"
                  aria-label="GitHub"
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="18"
                    height="18"
                    aria-hidden="true"
                    focusable="false"
                    fill="currentColor"
                  >
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                  </svg>
                </a>
              ) : null}
            </div>
          </footer>
        ) : null}
      </main>
    </div>
  );
}
