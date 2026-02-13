# frontend/Makefile — high-level orchestration for the static marketing site
# Run from frontend/ or via `make -C frontend <target>` from the monorepo root.
#
# Conventions:
#   make build          → fast default (no recrop)
#   make build-full     → data + derivatives + assets
#   make ci             → full quality-gate check
#   make deploy         → build + push to GitHub Pages
#
# All npm scripts are called through this Makefile so tooling has a single
# entry point regardless of whether a human or agent is driving.

SHELL := /bin/bash
.DEFAULT_GOAL := build

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DIST        := dist
NODE_BIN    := node_modules/.bin
PYTHON      := python3
PIP         := pip3
VENV_DIR    := offline-scripts/.venv

# Verbose / limit pass-through
ifdef VERBOSE
  export BUILD_VERBOSE=1
endif
ifdef LIMIT
  export BUILD_LIMIT=$(LIMIT)
endif
ifdef SUBSET
  export BUILD_SUBSET=$(SUBSET)
endif

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------
.PHONY: install install-python

install: node_modules

node_modules: package.json
	npm install
	@touch $@

install-python: $(VENV_DIR)/bin/activate

$(VENV_DIR)/bin/activate: offline-scripts/requirements.txt
	$(PYTHON) -m venv $(VENV_DIR)
	$(VENV_DIR)/bin/pip install -r offline-scripts/requirements.txt
	@touch $@

# ---------------------------------------------------------------------------
# Clean
# ---------------------------------------------------------------------------
.PHONY: clean clean-all

clean:
	npm run clean

clean-all: clean
	rm -rf node_modules $(VENV_DIR)

# ---------------------------------------------------------------------------
# Quality gates
# ---------------------------------------------------------------------------
.PHONY: typecheck lint stylelint format check

typecheck: install
	npm run typecheck

lint: install
	npm run lint

lint-fix: install
	npm run lint:fix

stylelint: install
	npm run stylelint

format: install
	npm run format

format-fix: install
	npm run format:write

check: typecheck lint stylelint format  ## Run all quality gates (no build)

# ---------------------------------------------------------------------------
# Data pipeline
# ---------------------------------------------------------------------------
.PHONY: data data-extract data-derive data-recrop data-recrop-missing data-refresh data-refresh-missing

data-extract: install
	npm run build:data:extract

data-derive: install
	npm run build:data:derive

data-recrop: install  ## Re-render ALL derivative tiles
	npm run build:data:derive:recrop

data-recrop-missing: install  ## Re-render only missing tiles
	npm run build:data:derive:recrop:missing

data: data-extract data-derive  ## Extract metadata + derive (no recrop)

data-refresh: install  ## Full refresh: extract + recrop all (verbose)
	npm run build:data:refresh

data-refresh-missing: install  ## Extract + recrop missing only
	npm run build:data:refresh:missing

# ---------------------------------------------------------------------------
# Offline Python analysis
# ---------------------------------------------------------------------------
.PHONY: analyze-faces

analyze-faces: install-python  ## Run MediaPipe face analysis → XMP injection
	$(VENV_DIR)/bin/python offline-scripts/analyze-faces.py

# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------
.PHONY: assets assets-copy assets-css assets-scripts

assets-copy: install
	npm run build:assets:copy

assets-scripts: install
	npm run build:assets:scripts

assets-css: install
	npm run build:assets:css
	npm run build:assets:postcss

assets: install  ## Build all assets (copy + scripts + css + compress)
	npm run build:assets

# ---------------------------------------------------------------------------
# Critical CSS
# ---------------------------------------------------------------------------
.PHONY: critcss

critcss: install
	npm run build:critcss

# ---------------------------------------------------------------------------
# Composite builds
# ---------------------------------------------------------------------------
.PHONY: build build-full build-full-refresh build-full-refresh-missing build-smoke build-subset-verify

build: clean assets  ## Fast build (no data pipeline)

build-full: clean data assets  ## Full build: data + assets

build-full-refresh: install  ## Full rebuild with recrop all
	npm run build:full:refresh

build-full-refresh-missing: install  ## Full rebuild, recrop missing only
	npm run build:full:refresh:missing

build-smoke: install  ## Smoke test build (LIMIT=120)
	npm run build:smoke

build-subset-verify: install  ## Verify specific subjects
	npm run build:subset:verify

# ---------------------------------------------------------------------------
# Verify dist
# ---------------------------------------------------------------------------
.PHONY: verify-dist

verify-dist: install
	npm run build:verify:dist

# ---------------------------------------------------------------------------
# Dev
# ---------------------------------------------------------------------------
.PHONY: dev-css

dev-css: install  ## Watch SCSS and recompile on change
	npm run dev:css

# ---------------------------------------------------------------------------
# CI
# ---------------------------------------------------------------------------
.PHONY: ci

ci: install  ## Full CI pipeline: build + typecheck + lint + stylelint + format
	npm run ci

# ---------------------------------------------------------------------------
# Deploy (GitHub Pages)
# ---------------------------------------------------------------------------
.PHONY: deploy

deploy: build-full verify-dist  ## Build, verify, then push dist to GitHub Pages
	@echo "== Deploying frontend/dist to GitHub Pages =="
	git add -f $(DIST)/
	git stash push -m "deploy-stash" -- $(DIST)/
	git checkout gh-pages 2>/dev/null || git checkout -b gh-pages
	git stash pop
	git add $(DIST)/
	git commit -m "deploy: $$(date -u +%Y-%m-%dT%H:%M:%SZ)" || true
	git push origin gh-pages
	git checkout -
	@echo "== Deploy complete =="

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------
.PHONY: help

help:  ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-28s\033[0m %s\n", $$1, $$2}'
