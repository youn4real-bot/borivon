# Self-hosted LiveKit for the Borivon live classroom

Open-source (Apache-2.0). **No LiveKit account, no third party.** Your VPS, your
keys, your data. The portal just points at this server via 3 env vars.

Total time: ~10 minutes. You need: the VPS IP, your domain's DNS panel, and the
Vercel dashboard.

---

## 1. DNS — point a subdomain at the VPS
In your domain registrar add an **A record**:

| Type | Name | Value |
|---|---|---|
| A | `live` | `<your VPS public IP>` |

→ gives you `live.borivon.com`. (Want a different name? Change it in `Caddyfile`
and use the same one for `LIVEKIT_URL` in step 4.)

## 2. Open the firewall
On the **Hostinger panel** (and/or `ufw` on the box) allow:

```
ufw allow 22/tcp     # SSH (don't lock yourself out)
ufw allow 80/tcp     # HTTPS certificate issuance
ufw allow 443/tcp    # secure signaling (wss)
ufw allow 7881/tcp   # WebRTC TCP fallback
ufw allow 7882/udp   # WebRTC media
ufw --force enable
```
Make sure nothing else is already using ports 80/443 on the box.

## 3. Put this folder on the VPS and run it
SSH into the VPS, then:

```bash
git clone https://github.com/youn4real-bot/borivon.git
cd borivon/livekit
bash setup.sh
```
`setup.sh` installs Docker if needed, generates your **API key + secret**
(printed once — copy them), and starts the server. Re-running is safe; it keeps
the same keys.

## 4. Tell the portal about it (Vercel → borivon → Settings → Environment Variables, Production)
```
LIVEKIT_URL=wss://live.borivon.com
LIVEKIT_API_KEY=<the API… key setup.sh printed>
LIVEKIT_API_SECRET=<the secret setup.sh printed>
```
Then **redeploy** (Vercel → Deployments → ⋯ → Redeploy), or tell me and I'll
trigger it.

## 5. Test
- You (supreme admin): avatar → **Live classroom** → tick *"Open to candidates"* → **Start**.
- Soufiane: avatar → **Live class** → agree → **Join**.
- You should see each other on camera; the engagement scorecard fills as you go.

---

### Verify it's healthy
```bash
docker compose logs -f livekit        # should show "starting LiveKit server"
curl -s http://localhost:7880         # should print: OK
```
From your laptop, `https://live.borivon.com` should return a LiveKit message (not
a cert error) once DNS + Caddy are up (~1 min for the certificate).

### Notes
- **Updating:** `docker compose pull && docker compose up -d`.
- **Restart:** `docker compose restart`. **Stop:** `docker compose down`.
- The `.env` (your secret) and Caddy's certs are gitignored — they never leave the VPS.
- TURN (for very locked-down candidate networks) isn't enabled — not needed for
  normal home/mobile networks. Ask if a candidate ever can't connect and we'll add it.
