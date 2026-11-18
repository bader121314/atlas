# Runbook: free public demo on Oracle Cloud (ADR-062)

About 30 minutes of clicking and one command. Costs nothing if you stay on
Always Free resources.

## 1. Account

1. Sign up at oracle.com/cloud/free. Oracle asks for a card to verify you;
   Always Free resources are not charged.
2. Pick a **home region** carefully, since it cannot be changed. Nearby
   regions (Jeddah, Riyadh) are fine; if Arm servers are never available
   there later, a large region (Frankfurt, Ashburn) usually has capacity.
3. In the console, open **Billing → Budgets** and create a budget of $1 with
   an email alert, so any accidental paid resource is noticed at once.

## 2. Server

1. **Compute → Instances → Create instance.**
2. Image: **Canonical Ubuntu 24.04**.
3. Shape: **Ampere → VM.Standard.A1.Flex**, 2 OCPUs, 12 GB memory. It must
   say "Always Free-eligible". If it reports "out of capacity", try again
   later or use 1 OCPU / 6 GB (slower first build, still fine). The upload
   scanner, ClamAV, uses about 1.5 GB of either.
4. Networking: keep the defaults and **assign a public IPv4 address**.
5. SSH keys: **Generate a key pair for me** and download the private key.
6. Create, wait until it is Running, and copy the **public IP address**.

## 3. Open the web ports

1. On the instance page, open the **subnet**, then its **security list**.
2. **Add ingress rules**: source `0.0.0.0/0`, TCP, destination port `80`;
   and the same for `443`.

(`setup.sh` opens the same ports in the server's own firewall.)

## 4. Install Atlas

From your computer (Windows PowerShell, macOS or Linux terminal):

```sh
ssh -i path/to/downloaded-key ubuntu@YOUR_PUBLIC_IP
```

Then on the server:

```sh
git clone https://github.com/bader121314/atlas.git
cd atlas/infrastructure/demo
./setup.sh
```

The first build takes 10 to 20 minutes. At the end it prints the address
(`https://atlas.<your-ip-with-dashes>.sslip.io`) and the demo sign-in, which
visitors also see on the sign-in page.

## Day to day

| Task                       | Command (in `atlas/infrastructure/demo`)                  |
| -------------------------- | --------------------------------------------------------- |
| Show the address and login | `./setup.sh password`                                     |
| Deploy the latest code     | `./setup.sh update`                                       |
| See logs                   | `sudo docker compose logs -f api worker web`              |
| Restart                    | `sudo docker compose --env-file .env restart`             |
| Back up the database now   | `./setup.sh backup` (kept in `~/atlas-backups`, newest 7) |
| Reset the demo data now    | `./setup.sh reset` (backs up first)                       |
| See the scheduled jobs     | `cat /etc/cron.d/atlas-demo` and `tail ~/atlas-demo.log`  |

Every night the server backs up the database (23:30 UTC) and reloads the
demo data (00:00 UTC), and GitHub checks every hour that the demo answers,
emailing you if it does not (ADR-067). To restore a backup:
`sudo docker compose --env-file .env exec -T postgres pg_restore -U atlas -d atlas --clean < ~/atlas-backups/<file>.dump`.

## Troubleshooting

- **Browser says the site cannot be reached:** check both security-list
  rules (step 3) and that `sudo docker compose ps` shows `caddy` running.
- **Certificate errors in the first minutes:** Caddy is still obtaining
  certificates; `sudo docker compose logs caddy` shows progress. If
  `sslip.io` hits Let's Encrypt limits, create two free DuckDNS names
  pointing at the IP, then delete `.env` and run
  `APP_HOST=... FILES_HOST=... ./setup.sh`.
- **File uploads fail:** `sudo docker compose logs seed` should show
  `Bucket atlas: created` or `exists`; re-run with
  `sudo docker compose --env-file .env up seed`.
- **The server disappeared:** Oracle can reclaim Always Free servers that
  stay nearly idle; recreate it and run the steps again (data is lost unless
  you kept a backup).
