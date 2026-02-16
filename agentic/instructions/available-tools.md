# Available Terminal Tools (Homebrew)

This file lists the terminal tools currently installed via Homebrew, available for agentic development.

## Key Development Tools

### flyctl (Fly.io CLI)

Manages Fly.io app lifecycle: deploy, secrets, scaling, Postgres, monitoring.

#### Common Commands

```sh
fly launch                          # scaffold new Fly app (generates fly.toml + Dockerfile)
fly deploy                          # build + deploy from fly.toml
fly secrets set KEY=value           # inject secret as env var (restarts app)
fly secrets import < .env           # bulk-import dotenv (use --stage to defer restart)
fly status                          # machine health + region + version
fly logs                            # tail live logs
fly ssh console                     # shell into running machine
fly postgres create                 # provision unmanaged Postgres cluster (you manage backups/upgrades)
fly postgres attach <pg-app>        # set DATABASE_URL secret on the consumer app
fly scale count 2                   # horizontal scale
fly scale vm shared-cpu-1x          # change VM size
fly checks list                     # health check state
```

#### Patterns (Do)

- Run `fly deploy` from the **monorepo root** where `fly.toml` lives (Docker build context). The Dockerfile is at `backend/infra/fly/Dockerfile` and referenced via `[build] dockerfile`.
- Use `fly secrets set` for all credentials; never commit `.env` with real values.
- Use `fly secrets import < .env --stage` to batch secrets without triggering a restart.
- Run migrations externally via `fly proxy` + `npx prisma migrate deploy` from a dev machine — Prisma is a dev-only tool excluded from the production image (`npm ci --omit=dev`).
- Set `internal_port` in `fly.toml` `[http_service]` to match the app's listen port (default 3000).
- Bind the app to `0.0.0.0` (not `localhost`) so `fly-proxy` can reach it.
- Keep Postgres in the same Fly private network — skip SSL/TLS for internal connections.
- Use `fly checks list` and `GET /v1/healthz` to verify deploy health before cutting traffic.

#### Anti-patterns (Do Not)

- Do not run `fly launch` from the monorepo root — it would generate config for the wrong directory.
- Do not hard-code `DATABASE_URL` in source; always read from `process.env`.
- Do not use `fly deploy --local-only` in CI without a Docker daemon available.
- Do not run `prisma migrate deploy` from inside the deployed container — Prisma is a dev-only dependency and is not present in the production image.
- Do not allocate a dedicated IPv4 unless you need non-443 public ports (costs extra).
- Do not store raw PII in Fly logs — ensure structured logging redacts sensitive fields.

### oci-cli (Oracle Cloud Infrastructure CLI)

Manages OCI resource lifecycle: compute, networking, storage, databases, Resource Manager stacks.

#### Common Commands

```sh
oci setup config                    # configure CLI (generates ~/.oci/config + API key)
oci iam region list                 # list all available OCI regions
oci iam availability-domain list    # list availability domains in current region
oci compute shape list --all        # list available compute shapes (VM types)
oci limits value list --service-name compute  # check service limits/quotas
oci compute instance list           # list compute instances in compartment
oci compute instance launch         # create a new compute instance
oci compute instance terminate      # delete compute instance
oci network vcn list                # list virtual cloud networks
oci network vcn create              # create VCN
oci psql db-system list             # list PostgreSQL database systems
oci os bucket list                  # list Object Storage buckets
oci resource-manager stack create   # create Terraform stack
oci resource-manager job create-plan-job     # run plan (dry-run)
oci resource-manager job create-apply-job    # provision resources
oci resource-manager job get-job-logs        # view job execution logs
```

#### Resource Manager (Terraform) Workflow

```sh
# Create stack from local .zip
oci resource-manager stack create \
  --compartment-id <ocid> \
  --config-source my-stack.zip \
  --variables file://variables.json \
  --display-name "Marketing Backend Stack"

# Plan (dry-run)
oci resource-manager job create-plan-job \
  --stack-id <stack-ocid>

# Apply (provision)
oci resource-manager job create-apply-job \
  --execution-plan-strategy AUTO_APPROVED \
  --stack-id <stack-ocid>

# Destroy resources
oci resource-manager job create-destroy-job \
  --stack-id <stack-ocid>
```

#### Patterns (Do)

- Store all stack Terraform configs in `backend/infra/oci/` with a `Makefile` for orchestration.
- Use Resource Manager (not local Terraform) for reproducible, state-managed deployments.
- Create all Always Free resources in **home region** (us-ashburn-1) to avoid charges.
- Use `--compartment-id` with tenancy OCID from `~/.oci/config` for root compartment.
- Use cloud-init in compute instances to install Docker + Docker Compose on first boot.
- Set `assign-public-ip: true` for instances in public subnets (Always Free includes 1 IP per instance).
- Use security lists to restrict ingress (SSH 22, HTTPS 443, app ports only).
- Monitor idle instance metrics (CPU/network/memory < 20% for 7 days = reclamation risk).

#### Anti-patterns (Do Not)

- Do not create Always Free resources outside home region — they will incur charges.
- Do not exceed Always Free quotas (2x E2.1.Micro or 4 OCPU A1.Flex total) — overages are paid.
- Do not hard-code compartment/tenancy OCIDs in source — read from `~/.oci/config` or env vars.
- Do not skip security lists or leave all ports open (0.0.0.0/0:*) — attackers scan public IPs.
- Do not provision GPU shapes (BM.GPU.*, VM.GPU.*) without service limit increase — Always Free has 0 GPU quota.
- Do not use VM.Standard.E2.1.Micro for ML workloads (1 GB RAM insufficient for ONNX/PyTorch runtimes).
- Do not let instances stay idle (< 20% utilization) for 7 days — Oracle may reclaim them.

### Other Relevant Tools

| Tool | Purpose |
|------|---------|
| `docker` / `docker-compose` | Local containerised dev; Fly uses Dockerfile for deploy |
| `gh` | GitHub CLI — PRs, releases, Actions |
| `postgresql@17` | Local Postgres for dev/test parity with Fly Postgres (unmanaged cluster) |
| `redis` | Local queue / cache backing (phase 2+) |
| `ripgrep` | Fast workspace search |
| `imagemagick` | Image processing (offline scripts) |
| `ffmpeg` | Media transcoding |
| `pyenv` / `pyenv-virtualenv` | Python version and venv management for offline-scripts |
| `fnm` | Fast Node version manager |
| `deno` | Alternative JS runtime (available, not primary) |

## Installed Formulas

- abseil
- aom
- apr
- apr-util
- argon2
- autoconf
- brotli
- bzip2
- ca-certificates
- cairo
- certifi
- cjson
- cmake
- colima
- composer
- coreutils
- curl
- dav1d
- ddrescue
- deno
- docker
- docker-completion
- docker-compose
- erlang
- expat
- ffmpeg
- flyctl
- fnm
- fontconfig
- freetds
- freetype
- fribidi
- gcc
- gd
- gettext
- gh
- giflib
- git-crypt
- git-filter-repo
- git-lfs
- glib
- gmp
- gnupg
- gnutls
- graphite2
- harfbuzz
- highway
- huggingface-cli
- icu4c@77
- icu4c@78
- imagemagick
- imath
- isl
- jpeg-turbo
- jpeg-xl
- krb5
- lame
- leptonica
- libarchive
- libass
- libassuan
- libavif
- libb2
- libcbor
- libdatrie
- libde265
- libdeflate
- libevent
- libfido2
- libgcrypt
- libgpg-error
- libheif
- libidn2
- libksba
- libmicrohttpd
- libmpc
- libnghttp2
- libnghttp3
- libngtcp2
- libplacebo
- libpng
- libpq
- librist
- libsodium
- libssh2
- libtasn1
- libthai
- libtiff
- libtool
- libunibreak
- libunistring
- libusb
- libvmaf
- libvpx
- libx11
- libxau
- libxcb
- libxdmcp
- libxext
- libxml2
- libxrender
- libyaml
- libzip
- lima
- little-cms2
- llvm
- lz4
- lzo
- m4
- mbedtls@3
- mhash
- mkcert
- mpdecimal
- mpfr
- mysql
- net-snmp
- nettle
- nginx
- npth
- oci-cli
- oniguruma
- openexr
- openjpeg
- openjph
- openldap
- openssl@3
- opus
- p11-kit
- pandoc
- pango
- pcre2
- pgvector
- php
- pinentry
- pipx
- pixman
- pkgconf
- postgresql@17
- protobuf
- pyenv
- pyenv-virtualenv
- python@3.13
- python@3.14
- readline
- redis
- ripgrep
- rtmpdump
- sdl2
- shaderc
- shared-mime-info
- sqlite
- subversion
- svt-av1
- tesseract
- testdisk
- tidy-html5
- unbound
- unixodbc
- utf8proc
- vapoursynth
- vulkan-headers
- vulkan-loader
- webp
- wp-cli
- wxwidgets@3.2
- x264
- x265
- xorgproto
- xz
- yt-dlp
- z3
- zimg
- zlib
- zstd

## Installed Casks

- alfred
- docker
- docker-desktop
