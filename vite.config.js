import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // '/api'로 시작하는 요청을 BytePlus 서버로 우회시킵니다.
      '/api': {
        target: 'https://ark.ap-southeast.bytepluses.com',
        changeOrigin: true,
      }
    }
  }
})