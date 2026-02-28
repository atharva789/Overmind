# Story: Async Auth Web API

We are building a Node.js/Express REST API for user management.

## Goals
- Authentication must be async (DB-backed, not hardcoded)
- All routes must require authentication via middleware
- Users can be created, listed, and deleted
- Token refresh should be supported
- Export the router as a named export `{ router }` for consistency

## Architecture
- `auth.ts` — login/logout/refreshToken, all async
- `router.ts` — Express routes, all protected by `requireAuth` middleware
- DB calls go through a `db` abstraction layer
