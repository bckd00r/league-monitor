import { defineNuxtConfig } from 'nuxt'

export default defineNuxtConfig({
  ssr: false,
  app: {
    baseURL: '/dashboard/'
  },
  runtimeConfig: {
    public: {
      relayBase: process.env.RELAY_BASE || 'http://localhost:8080'
    }
  }
})
