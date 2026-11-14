# Deployment — client-hosted, single-tenant

The app is designed to be installed **inside the client's environment** and operated by the client's
IT team (optionally with help from the vendor under a time-boxed grant — see
[VENDOR_ACCESS.md](VENDOR_ACCESS.md)). File content is read by the worker in memory and never leaves
the client's network.

| Option                | When                                                   | What runs where                                                                                                      |
| --------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **A. Docker Compose** | On-prem server/VM, or any cloud VM the client controls | Postgres + web + worker (+ optional Ollama) on one host                                                              |
| **B. Azure (Bicep)**  | Client prefers PaaS in their own Azure subscription    | Container Apps (web, worker, setup job) + PostgreSQL Flexible Server (private) + Key Vault (private) + Log Analytics |
| Vendor-hosted SaaS    | Demos / non-sensitive pilots only                      | Same images. **Not** recommended once content scanning is on, because content would be processed outside the client. |

## Network flows

| From   | To                                                       | Why                                          | Required                   |
| ------ | -------------------------------------------------------- | -------------------------------------------- | -------------------------- |
| worker | `login.microsoftonline.com`, `graph.microsoft.com` (443) | Token + read-only Graph calls, file download | Yes                        |
| web    | `login.microsoftonline.com` (443)                        | Entra SSO for app users                      | Only if SSO enabled        |
| worker | Client's Azure OpenAI / local model                      | LLM classification / policy drafting         | Only if `LLM_PROVIDER` set |
| worker | `TELEMETRY_ENDPOINT`                                     | Anonymised counts                            | Only if client opts in     |
| users  | web (443 via reverse proxy / ingress)                    | Dashboards                                   | Yes                        |

Nothing else is called. A default-deny egress firewall with the rows above is a good control.

## Sizing

| Tenant                    | Worker           | Database       | First full scan (indicative)        |
| ------------------------- | ---------------- | -------------- | ----------------------------------- |
| ≤ 500 users, ≤ 200k files | 1 vCPU, 2 GB RAM | 2 vCPU, 4 GB   | hours; later syncs are incremental  |
| ≤ 5,000 users, ≤ 2M files | 2 vCPU, 4 GB RAM | 2–4 vCPU, 8 GB | 1–3 days spread by `maxFilesPerRun` |

Graph throttling, not CPU, is usually the limit. Raise `concurrency` carefully (Settings → Content
scanning); the connector honours `Retry-After`.

## Option A — Docker Compose (on-prem)

Prerequisites: Docker Engine 24+ with Compose v2, 4 GB RAM, outbound 443 to Microsoft.

```bash
git clone <repo> lumen && cd lumen
cp .env.example .env
#   NEXTAUTH_SECRET=$(openssl rand -base64 32)
#   NEXTAUTH_URL=https://lumen.contoso.local
#   POSTGRES_PASSWORD=<strong password>
#   GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET   (docs/PILOT_SETUP.md)
#   SEED_DEMO=false
#   TELEMETRY_ENABLED=false   (default)
docker compose up -d --build

# Onboard the organisation (runs inside the worker container)
docker compose exec worker npm run worker -- create-tenant --name "Contoso" --slug contoso \
  --admin-email it.lead@contoso.co.nz --admin-name "IT Lead" --admin-password '<12+ chars>'
docker compose exec worker npm run worker -- check --tenant contoso
docker compose exec worker npm run worker -- policy-import --tenant contoso --file /app/packages/policy/samples/nz-psr-sample.yaml   # or set it in the UI
docker compose exec worker npm run worker -- sync --tenant contoso
```

- The web port binds to `127.0.0.1:3000` by default; publish it through the client's reverse proxy
  with TLS (IIS ARR, nginx, Traefik, Azure Application Gateway…). Set `WEB_BIND=0.0.0.0` only on a
  trusted network.
- **Local LLM (optional)**: `docker compose --profile local-llm up -d`, pull a model
  (`docker compose exec ollama ollama pull llama3.1:8b`), then set `LLM_PROVIDER=openai-compatible`,
  `LLM_BASE_URL=http://ollama:11434/v1`, `LLM_MODEL=llama3.1:8b` and restart the worker/web.
- **Backups**: back up the `pgdata` volume (or `pg_dump`). It contains metadata, findings and
  counts — never file content.
- **Upgrades**: `git pull && docker compose up -d --build` (the `setup` service applies schema changes).

## Option B — Azure, in the client's subscription (Bicep)

`deploy/azure/main.bicep` creates, in one resource group:

- **VNet** (`10.60.0.0/16`) with subnets for Container Apps, PostgreSQL and private endpoints.
- **PostgreSQL Flexible Server 16** with **private access only** (no public endpoint), 14-day backups.
- **Key Vault** (RBAC, purge protection, public access disabled, private endpoint) holding the
  database URL, NextAuth secret, Graph client secret and optional Azure OpenAI / SSO secrets.
- **User-assigned managed identity** with _Key Vault Secrets User_ on that vault only; the apps read
  secrets by Key Vault reference.
- **Container Apps environment** (VNet-integrated, **internal by default**), with:
  - `web` (1–2 replicas, health probe `/api/health`),
  - `worker` (1 replica, 1 vCPU / 2 GiB for in-memory extraction),
  - `setup` job (manual trigger) that applies the schema.
- **Log Analytics** for container logs (logs contain ids and statuses, never content).

```bash
# 1. Build and push images to the client's registry (or import a vendor release into it)
az acr build -r contosoacr -t lumen-web:0.2.0 --target web .
az acr build -r contosoacr -t lumen-worker:0.2.0 --target worker .

# 2. Deploy
az group create -n rg-lumen -l australiaeast
cp deploy/azure/main.parameters.example.json my.parameters.json   # fill in; keep out of git
az deployment group create -g rg-lumen -f deploy/azure/main.bicep -p @my.parameters.json

# 3. Let the identity pull images (if using ACR), then apply the schema
az role assignment create --assignee <identityPrincipalId output> --role AcrPull \
  --scope $(az acr show -n contosoacr --query id -o tsv)
az containerapp job start -g rg-lumen -n lumen-setup

# 4. Onboard the tenant
az containerapp exec -g rg-lumen -n lumen-worker --command "npm run worker -- create-tenant --name Contoso --slug contoso --admin-email it.lead@contoso.co.nz --admin-password <12+ chars>"
```

- **Reaching the app**: with `webIngressExternal=false` (default) the environment has a private IP
  (`environmentStaticIp` output). Point an internal DNS record at it, reach it over VPN/ExpressRoute or
  a peered hub, or front it with Application Gateway/Front Door + Private Link. With
  `webIngressExternal=true`, set `allowedIpRanges` to office egress IPs.
- **Region**: choose the client's preferred region (e.g. `australiaeast`; `newzealandnorth` where the
  required services are available).
- **Azure OpenAI**: set `llmProvider=azure-openai` and the endpoint/deployment/key of an Azure OpenAI
  resource in the **same subscription**. For a private endpoint behind custom DNS, add its host to
  `LLM_ALLOWED_HOSTS` (app setting).
- **Validation**: the template compiles cleanly with `bicep build` / `bicep lint` (v0.49). It has not
  yet been deployed end-to-end by the vendor; run `az deployment group what-if` first.

## Hardening checklist

- Graph app: certificate credential, Conditional Access for workload identities limited to the
  deployment's egress IP, 6-month review.
- App users: Entra SSO (`AZURE_AD_*`) and MFA; remove password users except break-glass.
- Keep `TELEMETRY_ENABLED=false` unless agreed; keep vendor access off when not in use.
- Restrict who can exec into containers / read the database (that is outside the app's audit log).
- Review **Governance → Audit log** regularly.
