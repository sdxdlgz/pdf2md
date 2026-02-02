# pdf2md（Mineru）部署到 Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fsdxdlgz%2Fpdf2md&root-directory=web&env=MINERU_API_TOKEN,BLOB_READ_WRITE_TOKEN)

这是一个 Next.js 应用（在 `web/` 目录），实现：

- 支持上传一个或多个 PDF（先存到 **Vercel Blob**，作为“上传存储层”）
- 调用 Mineru 的“**文件批量上传解析**”接口（`/file-urls/batch` + PUT 上传）进行解析，产出 **Markdown / JSON / DOCX**
- 下载时强制输出文件名与输入文件同名（仅扩展名不同：`.md/.json/.docx/.zip`）

## 架构（上传与转换隔离）

1. **Upload / Storage**：浏览器把 PDF 上传到 Vercel Blob（统一存储）。
2. **Convert / Mineru**：服务端向 Mineru 申请上传链接，再把 Blob 里的文件流式 PUT 到 Mineru；上传完成后 Mineru 会自动提交解析任务。

## 环境变量（必须）

需要配置以下环境变量（Vercel 与本地都要）：

- `MINERU_API_TOKEN`
  - Mineru 官网申请的 API Token
  - 服务端调用 Mineru API 时会带上 `Authorization: Bearer <token>`
- `BLOB_READ_WRITE_TOKEN`
  - Vercel Blob 的 Read‑Write Token（用于浏览器直传到 Blob）

## 环境变量（可选）

- `NEXT_PUBLIC_DONATE_URL`
  - 赞赏码/打赏链接（通常是图床图片地址）
  - 页面底部显示「打赏一下！」链接
- `NEXT_PUBLIC_GITHUB_URL`
  - GitHub 仓库链接
  - 页面底部显示 GitHub 图标链接

### 在 Vercel 上配置（推荐流程）

1. 在 Vercel 导入仓库后，先把项目 **Root Directory** 设置为 `web`。
2. 进入项目页面：
   - **Storage** → 创建/连接 **Blob**（创建后一般可以生成/复制 Read‑Write Token）
   - **Settings** → **Environment Variables**
3. 添加环境变量：
   - `MINERU_API_TOKEN`：填 Mineru Token
   - `BLOB_READ_WRITE_TOKEN`：填 Blob Read‑Write Token
   - （可选）`NEXT_PUBLIC_DONATE_URL`：赞赏码/打赏链接
   - （可选）`NEXT_PUBLIC_GITHUB_URL`：GitHub 仓库链接
4. 选择需要生效的环境（Production / Preview / Development），保存后重新部署。

### 本地开发配置

在 `web/` 下创建 `web/.env.local`：

```bash
cd web
cp .env.example .env.local
# 然后编辑 .env.local 填入实际值
```

## 部署到 Vercel（手动）

1. 在 Vercel 导入 GitHub 仓库。
2. 设置 **Root Directory** 为 `web`。
3. 按上面方式配置环境变量。
4. 部署。

## 本地运行

```bash
cd web
pnpm install
pnpm dev
```

打开 `http://localhost:3000`。

## Mineru 限制（来自官方说明）

- 单文件 ≤ 200MB，页数 ≤ 600
- 单次批量最多 200 个文件
- `/file-urls/batch` 申请的上传链接有效期 24 小时（需在有效期内完成 PUT 上传）
