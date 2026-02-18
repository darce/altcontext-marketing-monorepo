# backend/Makefile — high-level orchestration for the marketing backend service
# Run from backend/ or via `make -C backend <target>` from the monorepo root.
#
# Conventions:
#   make dev            → start local server + DB
#   make deploy         → build + fly deploy + verify health
#   make ci             → quality gates (typecheck + lint + format)
#   make db-*           → database lifecycle (start, stop, migrate, seed, studio)
#   make db-seed-baseline → seed retention/rollup smoke-test baseline data
#
# Prerequisites (Homebrew): flyctl, postgresql@18, node (via fnm)

SHELL := /bin/bash
.DEFAULT_GOAL := help

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
APP_PORT    := 3000
PG_DATA     := $(HOME)/.local/share/pg-backend
PG_LOG      := /tmp/pg-backend.log
PG_DB       := altcontext_dev
TEST_DB     := altcontext_test
PG_USER     := $(USER)
REPO_ROOT   := ..
FLY_APP     := marketing-altcontext
FLY_CONFIG  := fly.toml
FLY_DB_APP  := marketing-altcontext-db
FLY_DB_NAME := marketing_altcontext
BOOTSTRAP_PASSWORD_MIN_LENGTH := 12
BOOTSTRAP_PASSWORD_POLICY := min$(BOOTSTRAP_PASSWORD_MIN_LENGTH)-v1
FLY_REQUIRED_SECRETS := DATABASE_URL IP_HASH_PEPPER SESSION_SECRET BOOTSTRAP_TENANT_ID BOOTSTRAP_USER_EMAIL BOOTSTRAP_USER_PASSWORD BOOTSTRAP_USER_PASSWORD_POLICY
DATABASE_URL ?= postgresql://$(PG_USER)@localhost:5432/$(PG_DB)
TEST_DATABASE_URL := postgresql://$(PG_USER)@localhost:5432/$(TEST_DB)
TEST_IP_HASH_PEPPER := 0123456789abcdef0123456789abcdef

export DATABASE_URL

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------
.PHONY: install

install: node_modules

node_modules: package.json
	npm install
	@touch $@

# ---------------------------------------------------------------------------
# Quality gates
# ---------------------------------------------------------------------------
.PHONY: typecheck lint format check test dead-exports duplicates audit

typecheck: install
	npm run typecheck

lint: install
	npm run lint

lint-fix: install
	npm run lint:fix

format: install
	npm run format

format-fix: install
	npm run format:fix

dead-exports: install  ## Find unused exports (ts-prune)
	npm run dead-exports

duplicates: install  ## Detect copy-paste clones (jscpd)
	npm run duplicates

check: generate typecheck lint format  ## Run all quality gates

audit: check dead-exports duplicates  ## Full audit: quality gates + dead exports + duplication

test: install db-start db-create-test ## Run backend tests against isolated database
	DATABASE_URL="$(TEST_DATABASE_URL)" npm run migrate:reset
	NODE_ENV=test LOG_LEVEL=silent DATABASE_URL="$(TEST_DATABASE_URL)" IP_HASH_PEPPER="$(TEST_IP_HASH_PEPPER)" npm run test

# ---------------------------------------------------------------------------
# Database lifecycle (local Postgres)
# ---------------------------------------------------------------------------
.PHONY: db-init db-start db-stop db-status db-create db-create-test db-destroy db-reset db-studio db-seed-baseline

db-init:  ## Initialise a local Postgres data directory
	@if [ ! -d "$(PG_DATA)" ]; then \
		initdb -D $(PG_DATA) --auth=trust; \
		echo "Postgres data dir created at $(PG_DATA)"; \
	else \
		echo "Postgres data dir already exists at $(PG_DATA)"; \
	fi

db-start: db-init  ## Start local Postgres
	@pg_ctl -D $(PG_DATA) -l $(PG_LOG) status >/dev/null 2>&1 && \
		echo "Postgres already running" || \
		(pg_ctl -D $(PG_DATA) -l $(PG_LOG) start && echo "Postgres started (log: $(PG_LOG))")

db-stop:  ## Stop local Postgres
	@pg_ctl -D $(PG_DATA) stop 2>/dev/null || echo "Postgres not running"

db-status:  ## Show Postgres status
	@pg_ctl -D $(PG_DATA) status 2>/dev/null || echo "Postgres not running"

db-create: db-start  ## Create the dev database (idempotent)
	@createdb $(PG_DB) 2>/dev/null || echo "Database $(PG_DB) already exists"

db-create-test: db-start  ## Create the test database (idempotent)
	@createdb $(TEST_DB) 2>/dev/null || echo "Database $(TEST_DB) already exists"

db-destroy:  ## Drop the dev database
	dropdb --if-exists $(PG_DB)

db-reset: db-destroy db-create migrate  ## Drop, recreate, and migrate

db-studio: install  ## Open Prisma Studio
	npm run db:studio

db-seed-baseline: install db-start db-create migrate-deploy  ## Seed baseline visitor/session/event data for retention + rollup smoke tests
	npm run seed:baseline

# ---------------------------------------------------------------------------
# Migrations (Prisma)
# ---------------------------------------------------------------------------
.PHONY: migrate migrate-deploy migrate-status migrate-reset generate rollups-run rollups-backfill rollups-status rollups-discrepancy rollups-mv-init rollups-mv-refresh

migrate: install db-start  ## Create and apply a dev migration (interactive)
	npm run migrate

migrate-deploy: install db-start  ## Apply pending migrations (CI / production)
	npm run migrate:deploy

migrate-status: install db-start  ## Show migration status
	npm run migrate:status

migrate-reset: install db-start  ## Reset DB and re-apply all migrations
	npm run migrate:reset

generate: install  ## Regenerate Prisma Client
	npm run prisma:generate

rollups-run: install db-start  ## Generate rollups for recent default window
	npm run rollups:run

rollups-backfill: install db-start  ## Recompute rollups (pass ARGS='--from=YYYY-MM-DD --to=YYYY-MM-DD [--property-id=id]')
	npm run rollups:backfill -- $(ARGS)

rollups-status: install db-start  ## Show rollup freshness/status (pass ARGS='--property-id=id')
	npm run rollups:status -- $(ARGS)

rollups-discrepancy: install db-start  ## Compare raw counts vs rollup totals (pass ARGS='--from=YYYY-MM-DD --to=YYYY-MM-DD [--property-id=id]')
	npm run rollups:discrepancy -- $(ARGS)

rollups-mv-init: install db-start  ## Create metrics materialized view (pass ARGS='--refresh' to build immediately)
	npm run rollups:mv:init -- $(ARGS)

rollups-mv-refresh: install db-start  ## Refresh metrics materialized view
	npm run rollups:mv:refresh

# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
.PHONY: start dev stop deploy

start: install  ## Start the server (production-like)
	npm run start

dev: install db-start db-create  ## Start local dev: Postgres + server with watch
	@echo "== DB ready at $(DATABASE_URL) =="
	npm run dev

stop: db-stop  ## Stop local Postgres (server stopped via Ctrl-C)

deploy: fly-deploy  ## Alias for Fly deploy workflow (quality gates + deploy + health checks)

# ---------------------------------------------------------------------------
# Fly.io deployment
# ---------------------------------------------------------------------------
# fly.toml lives at monorepo root — run `fly deploy` from there, or `make fly-deploy` from backend/.

.PHONY: fly-launch fly-migrations-check fly-secrets-check fly-auth-secrets fly-auth-password-reset fly-auth-password-unset fly-deploy fly-deploy-only fly-secrets fly-logs fly-ssh fly-status fly-checks fly-start-stopped fly-pg-attach

fly-launch:  ## First-time Fly app scaffold
	fly launch -a $(FLY_APP)

fly-migrations-check:  ## Block deploy when Fly DB is behind local migration set
	@echo "== Checking Fly migration status for $(FLY_APP) =="
	@local_count="$$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"; \
		remote_count="$$(fly postgres connect -a $(FLY_DB_APP) -d $(FLY_DB_NAME) -c 'SELECT COUNT(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL;' 2>/dev/null | awk '/^[[:space:]]*[0-9]+[[:space:]]*$$/{print $$1; exit}')"; \
		if [ -z "$$remote_count" ]; then \
			echo "Unable to determine remote migration count for $(FLY_DB_APP)."; \
			echo "Apply migrations manually before deploy (fly proxy + prisma migrate deploy)."; \
			exit 1; \
		fi; \
		if [ "$$remote_count" -lt "$$local_count" ]; then \
			echo "Remote DB has $$remote_count applied migrations but local has $$local_count."; \
			echo "Run prisma migrate deploy against $(FLY_DB_APP) before deploying app code."; \
			exit 1; \
		fi; \
		echo "Migration preflight passed (remote=$$remote_count, local=$$local_count)."

fly-secrets-check:  ## Verify required Fly secrets are present before deploy
	@echo "== Checking required Fly secrets for $(FLY_APP) =="
	@secret_names="$$(fly secrets list -a $(FLY_APP) | awk 'NR>1 {print $$1}')"; \
		missing=0; \
		for key in $(FLY_REQUIRED_SECRETS); do \
			if ! printf '%s\n' "$$secret_names" | grep -qx "$$key"; then \
				echo "Missing Fly secret: $$key"; \
				missing=1; \
			fi; \
		done; \
		if [ "$$missing" -ne 0 ]; then \
			echo "Set missing secrets before deploy."; \
			echo "Use make fly-auth-secrets BOOTSTRAP_TENANT_ID=<uuid> BOOTSTRAP_USER_EMAIL=<email>"; \
			exit 1; \
		fi; \
		started_machine_count="$$(fly machine list -a $(FLY_APP) 2>/dev/null | awk 'NF > 2 && $$1 ~ /^[0-9a-f]/ && $$3 == "started" {count++} END {print count+0}')"; \
		if [ "$$started_machine_count" -gt 0 ]; then \
			echo "== Validating BOOTSTRAP_USER_PASSWORD policy on started machine =="; \
			attempt=1; \
			max_attempts=5; \
			verified=0; \
			while [ "$$attempt" -le "$$max_attempts" ]; do \
				check_output="$$(fly ssh console -a $(FLY_APP) -C "node -e 'const min=$(BOOTSTRAP_PASSWORD_MIN_LENGTH); const password=process.env.BOOTSTRAP_USER_PASSWORD ?? \"\"; if (password.length === 0) { console.error(\"BOOTSTRAP_USER_PASSWORD is empty\"); process.exit(11); } if (password.length < min) { console.error(\"BOOTSTRAP_USER_PASSWORD must be at least \" + min + \" characters\"); process.exit(12); }'" 2>&1)"; \
				check_status="$$?"; \
				if [ "$$check_status" -eq 0 ]; then \
					verified=1; \
					echo "Runtime password policy check passed."; \
					break; \
				fi; \
				if printf '%s\n' "$$check_output" | grep -Eq 'BOOTSTRAP_USER_PASSWORD is empty|must be at least'; then \
					echo "$$check_output"; \
					echo "Invalid BOOTSTRAP_USER_PASSWORD in Fly runtime env."; \
					echo "Run make fly-auth-password-reset (or make fly-auth-secrets) and redeploy."; \
					exit 1; \
				fi; \
				if printf '%s\n' "$$check_output" | grep -Eiq 'connection was refused|machine still attempting to start|could not find a good candidate|i/o timeout|deadline exceeded|connection reset'; then \
					echo "Fly SSH is not ready yet (attempt $$attempt/$$max_attempts); retrying in 3s..."; \
					attempt=$$((attempt + 1)); \
					sleep 3; \
					continue; \
				fi; \
				echo "$$check_output"; \
				echo "Unable to validate BOOTSTRAP_USER_PASSWORD via Fly SSH."; \
				exit 1; \
			done; \
			if [ "$$verified" -ne 1 ]; then \
				echo "Unable to validate BOOTSTRAP_USER_PASSWORD via Fly SSH after $$max_attempts attempts."; \
				echo "Ensure at least one machine is healthy, then rerun make fly-secrets-check."; \
				exit 1; \
			fi; \
		else \
			echo "No started machine available for runtime password-length verification; required-secret + policy-marker checks passed."; \
		fi

fly-auth-secrets:  ## Set dashboard auth secrets (password prompted if BOOTSTRAP_USER_PASSWORD is unset)
	@if [ -z "$(BOOTSTRAP_TENANT_ID)" ] || [ -z "$(BOOTSTRAP_USER_EMAIL)" ]; then \
		echo "Usage: make fly-auth-secrets BOOTSTRAP_TENANT_ID=<uuid> BOOTSTRAP_USER_EMAIL=<email> [BOOTSTRAP_USER_PASSWORD=<password>] [SESSION_SECRET=<64hex>]"; \
		exit 1; \
	fi
	@password="$(BOOTSTRAP_USER_PASSWORD)"; \
		if [ -z "$$password" ]; then \
			read -r -s -p "Bootstrap password: " password; \
			echo; \
		fi; \
		if [ -z "$$password" ]; then \
			echo "Bootstrap password is required."; \
			exit 1; \
		fi; \
		if [ "$$(printf '%s' "$$password" | wc -c | tr -d ' ')" -lt "$(BOOTSTRAP_PASSWORD_MIN_LENGTH)" ]; then \
			echo "Bootstrap password must be at least $(BOOTSTRAP_PASSWORD_MIN_LENGTH) characters."; \
			exit 1; \
		fi; \
		session_secret="$(SESSION_SECRET)"; \
		if [ -z "$$session_secret" ]; then \
			session_secret="$$(openssl rand -hex 32)"; \
		fi; \
		fly secrets set -a $(FLY_APP) \
			SESSION_SECRET="$$session_secret" \
			BOOTSTRAP_TENANT_ID="$(BOOTSTRAP_TENANT_ID)" \
			BOOTSTRAP_USER_EMAIL="$(BOOTSTRAP_USER_EMAIL)" \
			BOOTSTRAP_USER_PASSWORD="$$password" \
			BOOTSTRAP_USER_PASSWORD_POLICY="$(BOOTSTRAP_PASSWORD_POLICY)"

fly-auth-password-reset:  ## Rotate only BOOTSTRAP_USER_PASSWORD (prompted if unset)
	@password="$(BOOTSTRAP_USER_PASSWORD)"; \
		if [ -z "$$password" ]; then \
			read -r -s -p "New bootstrap password: " password; \
			echo; \
		fi; \
		if [ -z "$$password" ]; then \
			echo "Bootstrap password is required."; \
			exit 1; \
		fi; \
		if [ "$$(printf '%s' "$$password" | wc -c | tr -d ' ')" -lt "$(BOOTSTRAP_PASSWORD_MIN_LENGTH)" ]; then \
			echo "Bootstrap password must be at least $(BOOTSTRAP_PASSWORD_MIN_LENGTH) characters."; \
			exit 1; \
		fi; \
		fly secrets set -a $(FLY_APP) \
			BOOTSTRAP_USER_PASSWORD="$$password" \
			BOOTSTRAP_USER_PASSWORD_POLICY="$(BOOTSTRAP_PASSWORD_POLICY)"

fly-auth-password-unset:  ## Remove bootstrap password secrets (forces reconfiguration before deploy)
	@read -r -p "Unset BOOTSTRAP_USER_PASSWORD for $(FLY_APP)? [y/N] " confirm; \
		if [ "$$confirm" != "y" ] && [ "$$confirm" != "Y" ]; then \
			echo "Aborted."; \
			exit 1; \
		fi; \
		fly secrets unset -a $(FLY_APP) BOOTSTRAP_USER_PASSWORD BOOTSTRAP_USER_PASSWORD_POLICY

fly-deploy: fly-migrations-check fly-secrets-check check  ## Full deploy: preflight secrets + migrations → quality gates → build → push → verify
	cd $(REPO_ROOT) && fly deploy --config $(FLY_CONFIG) -a $(FLY_APP)
	@echo "== Waiting for health check =="
	@sleep 5
	fly checks list -a $(FLY_APP)

fly-deploy-only: fly-migrations-check fly-secrets-check  ## Deploy without running quality gates first
	cd $(REPO_ROOT) && fly deploy --config $(FLY_CONFIG) -a $(FLY_APP)

fly-secrets:  ## Import .env.production into Fly secrets (staged, no restart)
	@if [ ! -f .env.production ]; then \
		echo "Error: .env.production not found"; exit 1; \
	fi
	fly secrets import --stage < .env.production
	@echo "Secrets staged. Run 'fly deploy' to apply."

fly-logs:  ## Tail live production logs
	fly logs -a $(FLY_APP)

fly-ssh:  ## SSH into the running Fly machine
	fly ssh console -a $(FLY_APP)

fly-status:  ## Show Fly app status
	fly status -a $(FLY_APP)

fly-checks:  ## Show Fly health check state
	fly checks list -a $(FLY_APP)

fly-start-stopped:  ## Start all stopped Fly machines for this app
	@stopped_ids="$$(fly machine list -a $(FLY_APP) | awk 'NF > 2 && $$1 ~ /^[0-9a-f]/ && $$3 == "stopped" { print $$1 }')"; \
		if [ -z "$$stopped_ids" ]; then \
			echo "No stopped Fly machines for $(FLY_APP)."; \
			exit 0; \
		fi; \
		for id in $$stopped_ids; do \
			echo "Starting machine $$id"; \
			fly machine start $$id -a $(FLY_APP); \
		done

fly-pg-attach:  ## Attach a Fly Postgres cluster (sets DATABASE_URL)
	@read -p "Postgres app name: " pg_app && \
		fly postgres attach $$pg_app

# ---------------------------------------------------------------------------
# OCI deployment
# ---------------------------------------------------------------------------
.PHONY: oci-init oci-plan oci-apply oci-destroy oci-output oci-ssh oci-deploy oci-logs oci-health

OCI_DIR := infra/oci
OCI_INSTANCE_IP := $(shell cd $(OCI_DIR) && terraform output -raw instance_public_ip 2>/dev/null)

oci-init:  ## Initialize Terraform for OCI deployment
	@echo "== Initializing Terraform =="
	@if [ ! -f $(OCI_DIR)/terraform.tfvars ]; then \
		echo "Error: $(OCI_DIR)/terraform.tfvars not found"; \
		echo "Copy terraform.tfvars.example and populate with your OCI credentials"; \
		exit 1; \
	fi
	cd $(OCI_DIR) && terraform init

oci-plan: oci-init  ## Preview Terraform changes
	cd $(OCI_DIR) && terraform plan -var-file=terraform.tfvars

oci-apply: oci-init  ## Create OCI infrastructure (VCN + VM)
	cd $(OCI_DIR) && terraform apply -var-file=terraform.tfvars
	@echo ""
	@echo "== Infrastructure created! =="
	@echo "Instance IP: $(shell cd $(OCI_DIR) && terraform output -raw instance_public_ip)"
	@echo "SSH command: $(shell cd $(OCI_DIR) && terraform output -raw ssh_command)"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Wait ~3 minutes for cloud-init to complete"
	@echo "  2. Check cloud-init status: make oci-ssh (then: tail -f /var/log/cloud-init-output.log)"
	@echo "  3. Deploy code: make oci-deploy"

oci-destroy:  ## Destroy OCI infrastructure (WARNING: deletes everything)
	@read -p "Are you sure you want to destroy all OCI resources? [y/N] " confirm && \
		[ "$$confirm" = "y" ] || exit 1
	cd $(OCI_DIR) && terraform destroy -var-file=terraform.tfvars

oci-output:  ## Show Terraform outputs (instance IP, SSH command, etc.)
	cd $(OCI_DIR) && terraform output

oci-ssh:  ## SSH into the OCI instance
	@if [ -z "$(OCI_INSTANCE_IP)" ]; then \
		echo "Error: Instance IP not found. Run 'make oci-apply' first"; \
		exit 1; \
	fi
	ssh ubuntu@$(OCI_INSTANCE_IP)

oci-deploy: check  ## Deploy code to OCI instance
	@if [ -z "$(OCI_INSTANCE_IP)" ]; then \
		echo "Error: Instance IP not found. Run 'make oci-apply' first"; \
		exit 1; \
	fi
	@echo "== Deploying to $(OCI_INSTANCE_IP) =="
	@echo "== Syncing code =="
	rsync -avz --delete \
		--exclude 'node_modules' \
		--exclude 'dist' \
		--exclude '.git' \
		--exclude '.env*' \
		--exclude 'secrets' \
		--exclude 'logs' \
		./ ubuntu@$(OCI_INSTANCE_IP):/opt/marketing-backend/
	@echo ""
	@echo "== Building Docker image =="
	ssh ubuntu@$(OCI_INSTANCE_IP) "cd /opt/marketing-backend && docker compose -f docker-compose.oci.yml build"
	@echo ""
	@echo "== Running migrations =="
	ssh ubuntu@$(OCI_INSTANCE_IP) "cd /opt/marketing-backend && docker compose -f docker-compose.oci.yml run --rm backend sh -c 'npx prisma migrate deploy'"
	@echo ""
	@echo "== Starting services =="
	ssh ubuntu@$(OCI_INSTANCE_IP) "cd /opt/marketing-backend && docker compose -f docker-compose.oci.yml up -d"
	@echo ""
	@echo "== Deployment complete! =="
	@echo "Health check: make oci-health"
	@echo "View logs: make oci-logs"

oci-logs:  ## Tail logs from OCI instance
	@if [ -z "$(OCI_INSTANCE_IP)" ]; then \
		echo "Error: Instance IP not found. Run 'make oci-apply' first"; \
		exit 1; \
	fi
	ssh ubuntu@$(OCI_INSTANCE_IP) "cd /opt/marketing-backend && docker compose -f docker-compose.oci.yml logs -f"

oci-health:  ## Check backend health on OCI instance
	@if [ -z "$(OCI_INSTANCE_IP)" ]; then \
		echo "Error: Instance IP not found. Run 'make oci-apply' first"; \
		exit 1; \
	fi
	@echo "== Health check: http://$(OCI_INSTANCE_IP):3000/health =="
	@curl -f http://$(OCI_INSTANCE_IP):3000/health && echo "" || (echo "Health check failed"; exit 1)

# ---------------------------------------------------------------------------
# Git / GitHub
# ---------------------------------------------------------------------------
.PHONY: pr

pr:  ## Create a pull request for the current branch
	gh pr create --fill

# ---------------------------------------------------------------------------
# CI
# ---------------------------------------------------------------------------
.PHONY: ci

ci: check migrate-deploy  ## CI pipeline: quality gates + migration

# ---------------------------------------------------------------------------
# Clean
# ---------------------------------------------------------------------------
.PHONY: clean clean-all

clean:
	rm -rf dist/

clean-all: clean
	rm -rf node_modules

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------
.PHONY: help

help:  ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-28s\033[0m %s\n", $$1, $$2}'
