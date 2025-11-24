# League Monitor Dashboard (Nuxt)

Small Nuxt 3 dashboard to inspect sessions and trigger actions on the relay server.

Quick start (from the project root):

```powershell
# install root deps (existing project)
npm install

# install dashboard deps
cd dashboard
npm install

# run dashboard (dev mode)
npm run dev
```

The dashboard talks to the relay server endpoints (default http://localhost:8080). You can override with:
Real-time updates:
The dashboard uses a WebSocket admin subscription to receive live session updates and an activity feed. When you open the dashboard it subscribes automatically and will show live joins/leaves, heartbeats, and broadcast events.


```powershell
RELAY_BASE=http://your-relay:8080 npm run dev
```

Pages:
- `/` — sessions list (create session, broadcast restart/immediate)
- `/session/:token` — session details and follower list
