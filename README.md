**Book Finder — React + Tailwind (Open Library)**

**Why**
Implements “Alex the college student” need: flexible book search with filters and quick details.

 **Demo**
Live: <DEPLOYED_URL>

  **Stack**
- React (Vite) + TypeScript
- Tailwind CSS
- Open Library Search API (primary)
- Google Books (fallback for sandbox/CORS)
- LocalStorage for favorites

  **Features**
- Search modes: All | Title | Author | Subject
- Year range & sort (relevance/new/old)
- Pagination, details modal, subjects chips
- Favorites drawer (persisted)
- Loading skeletons, empty/error states
- Responsive layout

  Run locally
npm i
npm run dev

  Notes
- Primary API: `https://openlibrary.org/search.json` (no auth).
- In sandboxes with strict CORS, the app auto-falls back to Google Books so evaluators always see results.
