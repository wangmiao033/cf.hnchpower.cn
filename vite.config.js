import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { loadEnv } from 'vite'
import { HttpsProxyAgent } from 'https-proxy-agent'

const VERCEL_APP_HOST = 'cf-hnchpower-cn.vercel.app'

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
    plugins: [react()],
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
