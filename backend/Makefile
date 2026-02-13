# backend/Makefile — high-level orchestration for the marketing backend service
# Run from backend/ or via `make -C backend <target>` from the monorepo root.
#
# Conventions:
#   make dev            → start local server + DB
#   make deploy         → build + fly deploy + verify health
#   make ci             → quality gates (typecheck + lint + format)
#   make db-*           → database lifecycle (start, stop, migrate, seed, studio)
#
# Prerequisites (Homebrew): flyctl, postgresql@17, node (via fnm)

SHELL := /bin/bash
.DEFAULT_GOAL := help

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
APP_PORT    := 3000
PG_DATA     := $(HOME)/.local/share/pg-backend
PG_LOG      := /tmp/pg-backend.log
PG_DB       := altcontext_dev
PG_USER     := $(USER)
DATABASE_URL ?= postgresql://$(PG_USER)@localhost:5432/$(PG_DB)
TEST_SCHEMA := backend_test
TEST_DATABASE_URL := postgresql://$(PG_USER)@localhost:5432/$(PG_DB)?schema=$(TEST_SCHEMA)
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
.PHONY: typecheck lint format check test

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

check: typecheck lint format  ## Run all quality gates

test: install db-start db-create ## Run backend tests against isolated schema
	DATABASE_URL="$(TEST_DATABASE_URL)" npm run migrate:reset
	NODE_ENV=test LOG_LEVEL=silent DATABASE_URL="$(TEST_DATABASE_URL)" IP_HASH_PEPPER="$(TEST_IP_HASH_PEPPER)" npm run test

# ---------------------------------------------------------------------------
# Database lifecycle (local Postgres)
# ---------------------------------------------------------------------------
.PHONY: db-init db-start db-stop db-status db-create db-destroy db-reset db-studio

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

db-destroy:  ## Drop the dev database
	dropdb --if-exists $(PG_DB)

db-reset: db-destroy db-create migrate  ## Drop, recreate, and migrate

db-studio: install  ## Open Prisma Studio
	npm run db:studio

# ---------------------------------------------------------------------------
# Migrations (Prisma)
# ---------------------------------------------------------------------------
.PHONY: migrate migrate-deploy migrate-status migrate-reset generate

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

# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
.PHONY: start dev stop

start: install  ## Start the server (production-like)
	npm run start

dev: install db-start db-create  ## Start local dev: Postgres + server with watch
	@echo "== DB ready at $(DATABASE_URL) =="
	npm run dev

stop: db-stop  ## Stop local Postgres (server stopped via Ctrl-C)

# ---------------------------------------------------------------------------
# Fly.io deployment
# ---------------------------------------------------------------------------
.PHONY: fly-launch fly-deploy fly-deploy-only fly-secrets fly-logs fly-ssh fly-status fly-checks fly-pg-attach

fly-launch:  ## First-time Fly app scaffold (generates fly.toml + Dockerfile)
	fly launch

fly-deploy: check  ## Full deploy: quality gates → build → push → verify
	fly deploy
	@echo "== Waiting for health check =="
	@sleep 5
	fly checks list

fly-deploy-only:  ## Deploy without running quality gates first
	fly deploy

fly-secrets:  ## Import .env.production into Fly secrets (staged, no restart)
	@if [ ! -f .env.production ]; then \
		echo "Error: .env.production not found"; exit 1; \
	fi
	fly secrets import --stage < .env.production
	@echo "Secrets staged. Run 'fly deploy' to apply."

fly-logs:  ## Tail live production logs
	fly logs

fly-ssh:  ## SSH into the running Fly machine
	fly ssh console

fly-status:  ## Show Fly app status
	fly status

fly-checks:  ## Show Fly health check state
	fly checks list

fly-pg-attach:  ## Attach a Fly Postgres cluster (sets DATABASE_URL)
	@read -p "Postgres app name: " pg_app && \
		fly postgres attach $$pg_app

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
