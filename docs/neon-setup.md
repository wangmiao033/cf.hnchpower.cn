# Neon PostgreSQL 配置说明

本项目使用 [Neon](https://neon.tech) 托管的 **PostgreSQL**。应用运行时走连接池主机，结构迁移走直连主机。下面只说明连接方式，不记录真实密码或连接串。

## 连接串格式

Neon 在控制台提供的连接字符串通常为 PostgreSQL URI 形式，例如（**占位符，请勿提交真实密码**）：

```text
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

- **协议**：`postgresql://`（与 `postgres://` 等价，常见工具均支持）
- **认证**：`USER:PASSWORD@HOST`
- **库名**：路径中的 `DATABASE`（Neon 常为 `neondb` 或你自定义的名称）
- **SSL**：Neon 要求加密连接，URI 中通常包含 `sslmode=require`（或等价参数）

FastAPI、QuickSDK 数据服务和合同服务在运行时通过同一套规则解析连接串。

## Pooled connection 与 Direct connection

| 类型 | 说明 | 典型用途 |
|------|------|----------|
| **Pooled（连接池）** | 主机名第一段以 `-pooler` 结尾，例如 `ep-example-pooler....neon.tech` | **API 运行时**。Neon 主机若写成直连，运行时会自动插入 `-pooler`，密码和查询参数保持不变 |
| **Direct（直连）** | 去掉 `-pooler` 的计算节点 | **仅迁移**。`MIGRATION_EXECUTION_CONTEXT` 为 `deploy`、`manual` 或 `cli` 时使用 `DATABASE_URL_DIRECT`；没有直连变量时从主连接去掉 `-pooler` |

优先级：

1. 运行时先看 `DATABASE_URL`。有值时只采用 `DATABASE_URL_POOLED`（若为空则把 `DATABASE_URL` 改成 pooled）。
2. `DATABASE_URL` 为空时才使用 `QUICKSDK_DATABASE_URL` / `QUICKSDK_DATABASE_URL_POOLED`。两条变量可能指向不同库，不能互相覆盖。
3. 非 `neon.tech` 主机不会被改写。
4. 使用 pooled 主机时，进程内不再叠加 SQLAlchemy 队列池（`NullPool`），避免短生命周期实例占住额外会话。

## 预览与本地不要连生产计算节点

生产计算节点的公开标识是 `withered-mouse-06737032`。当 `VERCEL_ENV` 为 `preview` 或 `development`，或者未设置 `VERCEL_ENV` 但 `APP_ENV` 为 `development`、`dev`、`preview`、`test`、`staging` 时，运行时拒绝该主机。请改用 Neon 分支。只有临时排障才设置 `ALLOW_SHARED_PRODUCTION_DATABASE=1`。

未设置 `VERCEL_ENV`、且 `APP_ENV` 为空或 `production` 时，视为生产运行，不拦截该主机。拒绝信息不会包含连接串。

仓库根目录 `.env.example` 中提供了：

- `DATABASE_URL` — 应用主连接；Neon 直连地址也会在运行时改为 pooled
- `DATABASE_URL_POOLED` / `DATABASE_URL_DIRECT` — 可选的显式 pooled / 迁移直连
- `QUICKSDK_DATABASE_URL` 及对应 `_POOLED` / `_DIRECT` — 仅在没有 `DATABASE_URL` 时成为主连接

## 本地环境变量配置

1. 在仓库根目录复制模板：  
   `cp .env.example .env`（若你已有 `.env`，只需追加数据库相关变量）
2. 编辑 `.env`，填入 Neon 控制台复制的连接串（**勿将含真实密码的 `.env` 提交到 Git**）
3. 设置 **`DATABASE_URL`**。Neon 直连地址可以原样填写，运行时会改成 pooled；迁移任务会改回直连

命令行临时导出（示例，仍为占位符）：

```bash
export DATABASE_URL="postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require"
```

## 验证连接（独立脚本）

在 Neon 控制台创建项目后：

1. 打开目标数据库，点击 **Connect**
2. 复制连接串。运行时测试可以使用 pooled；迁移测试使用 direct
3. 本地 `.env` 中设置 `DATABASE_URL`。本地开发把 `APP_ENV` 设为 `development`，不要填生产计算节点
4. 安装 Python 依赖（连接测试需要，见 `docs/backend-requirements.md`）：

   ```bash
   pip install "psycopg[binary]"
   ```

5. 运行连接测试：

   ```bash
   python scripts/test_neon_connection.py
   ```

6. 若终端输出 **`Neon connection ok`**，说明当前 **`DATABASE_URL`** 配置可用。

脚本仅执行 `SELECT 1;`，不读写业务数据、不依赖本仓库前端代码。

## 与应用运行时的关系

- `backend/app/core/config.py` 的 `get_database_url()` 按上一节选择 pooled 或 direct，再规范成 `postgresql+psycopg://`
- `proxy/`、`contract_ai/`、`contract_terms/` 各有一份相同的 `neon_database_url.py`，因为 Vercel 按服务根目录部署，不会共享 `backend/app`
- 四个副本必须保持一致

## 环境变量一览（数据库相关）

| 变量名 | 说明 |
|--------|------|
| `DATABASE_URL` | 运行时主连接。Neon 主机自动改为 pooled |
| `DATABASE_URL_POOLED` | 可选。仅当 `DATABASE_URL` 有值时覆盖运行时地址 |
| `DATABASE_URL_DIRECT` | 迁移直连。迁移上下文中优先于 `DATABASE_URL` |
| `QUICKSDK_DATABASE_URL` | `DATABASE_URL` 为空时的运行时主连接，同样自动 pooled |
| `QUICKSDK_DATABASE_URL_POOLED` / `QUICKSDK_DATABASE_URL_DIRECT` | 只作用于 QuickSDK 主连接 |
| `MIGRATION_EXECUTION_CONTEXT` | `deploy`、`manual`、`cli` 时走直连 |
| `ALLOW_SHARED_PRODUCTION_DATABASE` | 设为 `1` 才允许非生产环境连接生产计算节点 |
| `VERCEL_ENV` / `APP_ENV` | 用来判断是否拦截生产计算节点。`VERCEL_ENV` 优先 |
