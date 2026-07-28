import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'node:fs'
import { loadEnv } from 'vite'
import { HttpsProxyAgent } from 'https-proxy-agent'

const VERCEL_APP_HOST = 'cf-hnchpower-cn.vercel.app'
const PRODUCT_SOURCE_SQL = resolve(
  __dirname,
  'backend/sql/022_create_quicksdk_product_sources.sql'
)

function decodeSqlValue(value) {
  return value.replace(/''/g, "'")
}

function loadProductSourceSeed() {
  const sql = readFileSync(PRODUCT_SOURCE_SQL, 'utf8')
  const tuplePattern =
    /\('qk-' \|\| md5\('((?:''|[^'])*)'\), '((?:''|[^'])*)', '((?:''|[^'])*)', '((?:''|[^'])*)'\)/g
  const timestamp = new Date().toISOString()

  return [...sql.matchAll(tuplePattern)].map((match, index) => ({
    id: `qk-local-${index + 1}`,
    game_name: decodeSqlValue(match[2]),
    product_code: decodeSqlValue(match[3]),
    source_file: decodeSqlValue(match[4]),
    created_at: timestamp,
    updated_at: timestamp
  }))
}

function sendJson(response, status, payload) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(payload))
}

async function readJsonBody(request) {
  let body = ''
  for await (const chunk of request) body += chunk
  return body ? JSON.parse(body) : {}
}

// Local preview only. Production uses the FastAPI route and persisted database table.
function productSourceDevApi() {
  let records = loadProductSourceSeed()

  return {
    name: 'product-source-dev-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url || '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/product-sources')) {
          next()
          return
        }

        if (request.method === 'GET' && url.pathname === '/api/product-sources') {
          const query = (url.searchParams.get('q') || '').trim().toLocaleLowerCase('zh-CN')
          const offset = Math.max(0, Number(url.searchParams.get('offset') || 0))
          const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit') || 500)))
          const filtered = query
            ? records.filter((record) =>
                `${record.game_name} ${record.product_code}`
                  .toLocaleLowerCase('zh-CN')
                  .includes(query)
              )
            : records
          const sorted = [...filtered].sort((left, right) =>
            left.game_name.localeCompare(right.game_name, 'zh-CN')
          )

          sendJson(response, 200, {
            items: sorted.slice(offset, offset + limit),
            total: filtered.length,
            latest_import_at: records.reduce(
              (latest, record) =>
                !latest || record.updated_at > latest ? record.updated_at : latest,
              null
            )
          })
          return
        }

        if (request.method === 'POST' && url.pathname === '/api/product-sources/import') {
          try {
            const payload = await readJsonBody(request)
            const sourceFile = String(payload.source_file || '').trim() || null
            const incoming = Array.isArray(payload.rows) ? payload.rows : []
            let inserted = 0
            let updated = 0
            let skipped = 0

            incoming.forEach((item) => {
              const gameName = String(item.game_name || '').trim()
              const productCode = String(item.product_code || '').trim()
              if (!gameName || !productCode) {
                skipped += 1
                return
              }

              const existing = records.find((record) => record.product_code === productCode)
              if (existing) {
                if (existing.game_name === gameName && existing.source_file === sourceFile) {
                  skipped += 1
                  return
                }
                existing.game_name = gameName
                existing.source_file = sourceFile
                existing.updated_at = new Date().toISOString()
                updated += 1
                return
              }

              const timestamp = new Date().toISOString()
              records.push({
                id: `qk-local-${records.length + 1}`,
                game_name: gameName,
                product_code: productCode,
                source_file: sourceFile,
                created_at: timestamp,
                updated_at: timestamp
              })
              inserted += 1
            })

            sendJson(response, 200, {
              inserted,
              updated,
              skipped,
              total: records.length
            })
          } catch (error) {
            sendJson(response, 400, {
              detail: error instanceof Error ? error.message : 'Invalid import payload'
            })
          }
          return
        }

        sendJson(response, 404, { detail: 'Not Found' })
      })
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const vercelAgent = env.DEV_HTTPS_PROXY
    ? new HttpsProxyAgent(env.DEV_HTTPS_PROXY)
    : undefined
  const vercelProxy = {
    target: `https://${VERCEL_APP_HOST}`,
    changeOrigin: true,
    secure: true,
    ...(vercelAgent ? { agent: vercelAgent } : {})
  }

  return {
    plugins: [productSourceDevApi(), react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    server: {
      port: 3000,
      open: false,
      proxy: {
        '/api/contracts': vercelProxy,
        '/api/partners': vercelProxy,
        '/api/quicksdk': vercelProxy,
        '/api': {
          target: 'https://caiwuapi.hnchpower.cn',
          changeOrigin: true,
          secure: true,
          cookieDomainRewrite: '',
          configure(proxy) {
            proxy.on('proxyRes', (proxyResponse) => {
              const cookies = proxyResponse.headers['set-cookie']
              if (!cookies) return
              proxyResponse.headers['set-cookie'] = cookies.map((cookie) =>
                cookie
                  .replace(/;\s*Secure/gi, '')
                  .replace(/;\s*SameSite=None/gi, '; SameSite=Lax')
              )
            })
          }
        }
      }
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: false,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html')
        },
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('node_modules/xlsx')) return 'xlsx'
            if (id.includes('node_modules/dayjs')) return 'date'
            if (
              id.includes('node_modules/react') ||
              id.includes('node_modules/react-dom') ||
              id.includes('node_modules/scheduler')
            ) {
              return 'react'
            }
            return 'vendor'
          }
        }
      }
    },
    test: {
      environment: 'node',
      include: ['src/**/*.{test,spec}.{js,ts}']
    }
  }
})
