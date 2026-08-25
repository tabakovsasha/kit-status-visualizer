SHELL := /bin/bash

init:
	chmod +x scripts/init-secrets.sh && ./scripts/init-secrets.sh

dev: init
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

build: init
	docker compose build

up: init
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f --tail=200

migrate:
	docker compose run --rm backend npm run -w backend prisma:migrate

seed:
	docker compose run --rm backend npm run -w backend prisma:seed

test:
	npm test

lint:
	npm run lint

e2e:
	npm run -w backend test:e2e
