<template>
  <div class="container">
    <h1>League Monitor — Dashboard</h1>

    <div class="controls">
      <button @click="reload">Refresh</button>
      <button @click="createSession">Create Session</button>
    </div>

    <div v-if="loading">Loading sessions...</div>

    <table v-if="!loading" class="sessions">
      <thead>
        <tr>
          <th>Token</th>
          <th>Controller</th>
          <th>Followers</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in sessions" :key="s.token">
          <td><NuxtLink :to="`/session/${s.token}`">{{ s.token }}</NuxtLink></td>
          <td>{{ s.hasController ? 'Yes' : 'No' }}</td>
          <td>{{ s.followerCount }}</td>
          <td>
            <button @click="broadcastImmediate(s.token)">Immediate</button>
            <button @click="broadcastRestart(s.token)">Restart</button>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="error" class="error">{{ error }}</div>

    <h2>Activity</h2>
    <div class="activity">
      <ul>
        <li v-for="(a, idx) in activity" :key="idx">
          <small>{{ new Date(a.timestamp).toLocaleTimeString() }} · {{ a.level }}</small>
          <div>{{ a.message }}<span v-if="a.status"> — {{ JSON.stringify(a.status) }}</span></div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRuntimeConfig } from 'nuxt/app'
import { ref } from 'vue'
const cfg = useRuntimeConfig()
const relayBase = String(cfg.public.relayBase || 'http://localhost:8080')

const sessions = ref<any[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const activity = ref<any[]>([])

let ws: WebSocket | null = null

async function fetchSessions() {
  loading.value = true
  try {
    const r = await fetch(`${relayBase}/sessions`)
    const data = await r.json()
    sessions.value = data.sessions || []
    error.value = null
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

async function broadcastImmediate(token: string) {
  await fetch(`${relayBase}/sessions/${token}/immediate`, { method: 'POST' })
  await fetchSessions()
}

async function broadcastRestart(token: string) {
  await fetch(`${relayBase}/sessions/${token}/restart`, { method: 'POST' })
  await fetchSessions()
}

async function createSession() {
  await fetch(`${relayBase}/create-session`, { method: 'POST' })
  await fetchSessions()
}

function reload() { fetchSessions() }

fetchSessions()

// WebSocket admin subscribe
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
        if (msg.type === 'SESSIONS_UPDATE' && msg.payload) {
          sessions.value = msg.payload.sessions || sessions.value;
        }

        if (msg.type === 'ACTIVITY' && msg.payload) {
          // push to top
          activity.value.unshift(msg.payload);
          if (activity.value.length > 200) activity.value.pop();
        }
      } catch (e) {
        console.warn('ws parse error', e);
      }
    };

    ws.onclose = () => {
      // attempt reconnect
      setTimeout(() => setupWs(), 2000);
    };
  } catch (e) {
    console.warn('ws error', e);
  }
}

setupWs()
</script>

<style scoped>
body { font-family: system-ui, Arial; }
.container { max-width: 1000px; margin: 30px auto; }
.controls { margin-bottom: 12px }
.sessions { width: 100%; border-collapse: collapse }
.sessions th, .sessions td { border: 1px solid #ddd; padding: 8px }
.sessions th { background: #f5f5f5 }
.error { color: red; margin-top: 10px }
</style>
