<template>
  <div class="container">
    <h1>Session Details</h1>

    <div v-if="loading">Loading session...</div>

    <div v-if="!loading && session">
      <div class="meta">
        <strong>Token:</strong> {{ session.token }}<br/>
        <strong>Created:</strong> {{ new Date(session.createdAt).toLocaleString() }}<br/>
        <strong>Controller:</strong> {{ session.hasController ? 'Yes' : 'No' }}<br/>
        <strong>Followers:</strong> {{ session.followerCount }}
      </div>

      <div class="actions">
        <button @click="doImmediate">Send Immediate Start</button>
        <button @click="doRestart">Send Restart</button>
      </div>

      <h2>Followers</h2>
      <ul>
        <li v-for="f in session.followers" :key="f.clientId">
          {{ f.clientId }} — Connected: {{ new Date(f.connectedAt).toLocaleString() }}
        </li>
      </ul>

      <h3>Activity</h3>
      <ul>
        <li v-for="(a, idx) in activity" :key="idx">
          <small>{{ new Date(a.timestamp).toLocaleTimeString() }} · {{ a.level }}</small>
          <div>{{ a.message }}</div>
        </li>
      </ul>
    </div>

    <div v-if="error" class="error">{{ error }}</div>

    <NuxtLink to="/">Back</NuxtLink>
  </div>
</template>

<script setup lang="ts">
import { useRoute, useRuntimeConfig } from 'nuxt/app'
import { ref } from 'vue'

const route = useRoute()
const cfg = useRuntimeConfig()
const relayBase = String(cfg.public.relayBase || 'http://localhost:8080')

const session = ref<any | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const token = route.params.token as string

async function fetchSession() {
  loading.value = true
  try {
    const r = await fetch(`${relayBase}/sessions/${token}`)
    const data = await r.json()
    session.value = data.session || null
    error.value = null
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

async function doImmediate() {
  await fetch(`${relayBase}/sessions/${token}/immediate`, { method: 'POST' })
}

async function doRestart() {
  await fetch(`${relayBase}/sessions/${token}/restart`, { method: 'POST' })
}

fetchSession()

// WebSocket admin subscribe for real-time updates
let ws: WebSocket | null = null
const activity = ref<any[]>([])

function setupWs() {
  try {
    const wsUrl = relayBase.replace(/^http/, 'ws');
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      ws?.send(JSON.stringify({ type: 'ADMIN_SUBSCRIBE' }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data.toString());
        if (msg.type === 'SESSIONS_UPDATE' && msg.payload && msg.payload.sessions) {
          const s = msg.payload.sessions.find((x: any) => x.token === token);
          if (s) {
            session.value = s
          }
        }

        if (msg.type === 'ACTIVITY' && msg.payload) {
          // Show only for this session token when available
          if (!msg.payload.message || msg.payload.message.indexOf(token) !== -1) {
            activity.value.unshift(msg.payload)
            if (activity.value.length > 200) activity.value.pop()
          }
        }
      } catch (e) {
        console.warn('ws parse error', e)
      }
    };

    ws.onclose = () => setTimeout(() => setupWs(), 2000);
  } catch (e) {
    console.warn('ws error', e)
  }
}

setupWs()
</script>

<style scoped>
.container { max-width: 800px; margin: 20px auto }
.meta { margin-bottom: 12px }
.actions { margin-bottom: 12px }
.error { color: red }
</style>
