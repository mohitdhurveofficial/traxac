# Railway release command: migrations run once per deploy, before the new
# containers take traffic.
release: pnpm db:migrate
web: pnpm --filter @traxac/api start
worker: pnpm --filter @traxac/worker start
