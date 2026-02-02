import MineruUploader from "@/app/components/MineruUploader";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <main className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">PDF2MD（Mineru API）</h1>
          <p className="mt-2 text-sm text-zinc-600">
            批量上传 PDF，生成 Markdown、JSON、DOCX；下载文件名保持与输入文件同名（仅扩展名不同）。
          </p>
        </header>

        <MineruUploader />

        <footer className="mt-10 border-t border-zinc-200 pt-6 text-xs text-zinc-500">
          提示：本项目先把文件保存到 Vercel Blob（作为“上传存储”层），再由服务端调用 Mineru 的
          <span className="mx-1 font-mono">/file-urls/batch</span>
          获取上传链接并上传触发解析（作为“转换”层）。
        </footer>
      </main>
    </div>
  );
}
