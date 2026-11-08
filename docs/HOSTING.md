# Put Prompt Lab online

Hosting keeps your website on another computer so people can visit it even when your laptop is off.

## The free options

**For the complete app as it is built today, I recommend Oracle Cloud Always Free.** It gives you a small online computer where the website, saved progress, and background grading can run together. This project already includes the files for that setup. It takes more setup than Vercel.

Choose only resources marked **Always Free-eligible**, within your account's limits. Free machines depend on regional availability; a free slot is not guaranteed. [Oracle's free-resource guide](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

**Vercel** has a free Hobby plan for personal, non-commercial projects. It now supports background workers through a public beta, including on Hobby within its usage limits. However, this repository needs Vercel-specific deployment work plus hosted database and queue connections. Simply importing it as a static website will not make the full app work. [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Vercel workers](https://vercel.com/docs/daemons)

**Render** offers free web services, but its dedicated background workers have no free instance option, and its free database expires after 30 days. It is useful for previews; it is not an entirely free, permanent home for this app unchanged. [Render's free plans](https://render.com/docs/free)

**Free hosting does not include free AI usage.** AI grading uses your Anthropic account. The current online setup also requires an email service for sign-in links. You can keep testing locally without those paid AI calls.

## Step 1: Create an Oracle account

Open [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/). Complete account creation and any identity or card verification yourself. Choose a home region and stay within the Always Free resources offered there.

## Step 2: Create your server

In the Oracle dashboard, choose **Compute → Instances → Create instance**.

- Name it **prompt-lab**.
- Select **Ubuntu 24.04**.
- Choose an **Always Free-eligible Ampere A1** machine, with a small configuration within the free allowance displayed for your account.
- Use the normal free boot-disk size, a public network, and a public IP address.
- Download the generated private SSH key. Keep it safe; it lets you connect to your server.
- Check eligibility and the cost shown, then create the instance. Wait for **Running**.

If free capacity is unavailable, try another availability domain in the same home region or try later. Do not switch to a paid machine accidentally. [Oracle's instance instructions](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/launchinginstance.htm)

## Step 3: Allow visitors to reach the website

In the server's network/security settings, allow incoming **TCP ports 80 and 443**. These are the normal website ports. Restrict SSH port 22 to your own IP where possible. Keep the database and Redis ports private.

Ubuntu's own firewall may also need matching rules. Check both firewall layers if the website does not load; do not disable the firewalls entirely.

## Step 4: Connect to the server

Oracle shows your public IP and connection instructions. In PowerShell, replace the placeholders below with your downloaded key and server IP:

```powershell
ssh -i "C:\path\to\your-private-key.key" ubuntu@YOUR_SERVER_IP
```

You are now typing on the online server. Never upload the private key to GitHub.

## Step 5: Install Docker

Docker starts all the website's parts together. Follow Docker's official [Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/), using its **apt repository** method and including the Compose plugin. Then check:

```sh
sudo docker run hello-world
sudo docker compose version
```

## Step 6: Download Prompt Lab

On the server:

```sh
sudo apt update
sudo apt install -y git
git clone --branch feature/prompt-lab-fullstack https://github.com/saadat-hub/CS-498-Team-013.git
cd CS-498-Team-013
```

This branch contains the completed local app. Once its pull request is merged, you can use `main` instead.

## Step 7: Choose your website address

Use a domain you own, or create a free subdomain through [Duck DNS](https://www.duckdns.org/). Point it at the server's public IP. Your address might look like `your-prompt-lab.duckdns.org`; that example is not a reserved name. [Duck DNS documentation](https://www.duckdns.org/spec.jsp)

The included Caddy service sets up HTTPS once the address points to your server and ports 80/443 are reachable.

## Step 8: Add your private settings

Create a private settings file:

```sh
cp .env.example .env
chmod 600 .env
nano .env
```

Fill in these settings:

| Setting                                         | What to enter                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `SITE_DOMAIN`                                   | Your website address, without `https://`                         |
| `POSTGRES_PASSWORD`                             | A long, random password made of letters and numbers              |
| `SESSION_SECRET`                                | A random sign-in protection secret                               |
| `IP_HASH_SECRET`                                | A different random secret                                        |
| `ANTHROPIC_API_KEY`                             | Your AI service key                                              |
| `TOKEN_COUNT_MODEL`, `RUN_MODEL`, `JUDGE_MODEL` | The model IDs selected for your AI account                       |
| `PRICES_JSON`                                   | The matching prices, as explained in [Deployment](DEPLOYMENT.md) |
| `LLM_DAILY_BUDGET_USD`                          | Your maximum daily AI budget; start small                        |
| `USER_DAILY_MODEL_RUNS`                         | Each learner's daily AI-graded attempt limit                     |
| `EMAIL_API_KEY`                                 | Your Resend email-service key                                    |
| `EMAIL_FROM`                                    | An address approved by your email service                        |

Use `openssl rand -hex 32` to generate a random secret. Run it separately for each secret and save the results only in `.env`. Never commit that file or paste its keys into chat.

Keep `NODE_ENV=production`, `LOCAL_DEVELOPMENT=false`, `LLM_PROVIDER=anthropic`, `EMAIL_PROVIDER=resend`, and `FEATURE_CODE_TESTS=false`. GitHub/Google sign-in is optional; leave those credential pairs blank until configured.

The supplied server setup fills in `APP_ORIGIN`, `API_URL`, `DATABASE_URL`, `REDIS_URL`, `API_PORT`, and `TRUST_PROXY` for you when it starts. Their blank example values are overridden.

The current app will refuse to start online if required AI/email settings are missing. A free website address does not automatically verify an email-sending domain. Follow your email provider's verification process before offering public email sign-in. The laptop-only local session button must remain disabled online.

## Step 9: Start the website

From the project folder on the server:

```sh
sudo docker compose --env-file .env -f infra/compose.selfhost.yml up -d --build
```

The first start downloads what is needed, builds the app, prepares its saved-data tables, and starts the website and grading services. Allow several minutes.

Check the result:

```sh
sudo docker compose --env-file .env -f infra/compose.selfhost.yml ps
sudo docker compose --env-file .env -f infra/compose.selfhost.yml logs --tail=100 release api worker caddy
```

The release task should finish successfully. The website and worker should stay running. Correct any missing settings in `.env` and repeat the start command if necessary.

## Step 10: Try it online

Visit `https://YOUR_SITE_DOMAIN`, then:

1. Open the challenge collection.
2. Request a sign-in email and confirm the link returns to your website.
3. Complete **Hello, function** and confirm progress updates.
4. Save a prompt, refresh, and confirm it remains there.
5. Submit an AI-graded challenge and confirm feedback arrives.

The page at `https://YOUR_SITE_DOMAIN/readyz` should report `ready`.

## Updating and keeping your work safe

The database uses a persistent Docker volume. Restarting containers keeps your data; commands that delete volumes do not. Arrange off-server backups before inviting real learners and keep your private settings backed up separately.

To update the app, run `git pull --ff-only` in the server's project folder, then repeat the start command from step 9. Check the release task and readiness page afterward.

## If you would rather use Vercel

The next development step would be to add a Vercel web entry point, configure the existing worker as a daemon, connect hosted PostgreSQL/Redis, and supply the private settings. Its free limits may suit a small personal demo, but the current Docker setup is not a one-click Vercel deployment. Oracle uses the deployment files already included here.

Provider plans and availability can change. Check the current free labels and limits when signing up; no hosting account or deployment has been created by this guide.
