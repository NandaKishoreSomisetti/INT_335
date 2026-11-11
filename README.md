# INT_335
Where did i park

# PARKTRACE — Campus Vehicle Parking & Retrieval

<p align="left">
  <img src="./assets/parktrace-logo.png" alt="PARKTRACE emblem" width="64" height="64" />
</p>

**Tagline:** *Park smart. Find your way back.*  
**Short description:** *Smarter campus parking. Less searching, easier returns.*

**PARKTRACE** is a campus vehicle parking discovery and parked-vehicle retrieval web application. It helps students, faculty, and staff find compatible parking sections around academic blocks for **bikes (two-wheelers)**, **cars**, and **other campus-approved vehicles**, and record their parked location so they can easily return to their vehicle later.

#Website live link
<a href="https://nandakishoresomisetti.github.io/INT_335/">PARKTRACE</a>

---

## Visual Preview

![PARKTRACE public homepage background studio composition](./assets/hero-car-clean.jpg)

---

## Feature Overview & Implementation Status

### Completed Features
- **Public Homepage (`index.html`)**
  - Responsive single-screen hero composition with the official PARKTRACE emblem (`./assets/parktrace-logo.png`), editorial brand lockup, glass authentication panel (`Log in` and `Sign up` tabs), accessible Support modal (`<dialog closedby="any">`), and a compact click-to-reveal **Reviews** section.
  - Device-level **Remember me** convenience that remembers the user's email address and routes Supabase session tokens between `localStorage` and `sessionStorage` without ever storing raw passwords on the client.
- **Supabase Authentication & Profile Synchronization (`js/services/supabaseClient.js`, `js/services/authService.js`, `server.mjs`)**
  - Powered by `@supabase/supabase-js` using `supabase.auth.signUp()`, `supabase.auth.signInWithPassword()`, `supabase.auth.signOut()`, and reactive session state via `supabase.auth.onAuthStateChange()`.
  - Synchronizes user profiles with the PostgreSQL `public.profiles` table referencing `auth.users(id)` with Row Level Security (RLS) enabled and an automatic `on_auth_user_created` database trigger (`supabase/migrations/001_create_profiles.sql`).
  - Zero local file/folder data storage for user credentials or profiles.
- **Authenticated Cinematic Hub & Glass Navigation Bar (`js/components/CinematicHub.js`)**
  - Floating horizontal glass navigation bar with the official logo and `PARKTRACE` wordmark on the left, primary views (`Overview`, `Find Parking`, `My Vehicle`, `Reviews`), and secondary controls on the right (`Staff Controls` for authorized staff only, `Support`, `Profile`, and `Log out` last).
- **Overview Dashboard**
  - Adapts to the user's active parking state: prioritizes **Find parking** when no vehicle is saved, and highlights the saved vehicle summary with **Find my vehicle**, **Correct location**, and **I’ve left** actions when an active parking session exists.
- **Campus Parking Discovery (`Find Parking`)**
  - Filters configured parking sections by **vehicle type** (`bike`, `car`, `other`) and **destination / academic block**.
  - Displays each section's parent lot, short code, accepted vehicle types, nearby destination, entrance location, capacity/space information, permit restrictions, current availability status (`Available`, `Limited`, `Full`, `Closed`, `Unknown`), last-updated timestamp, and source attribution.
  - Automatically recommends open alternative compatible sections when all primary sections for a selected destination are `Full` or `Closed`.
- **Parked-Vehicle Memory Aid & Retrieval (`My Vehicle`)**
  - Saves a private parking record structured as **Parking Lot → Vehicle Section → Row → Bay**, along with vehicle type, parking timestamp, optional landmark note, optional on-demand GPS coordinates (`navigator.geolocation`), and an optional private surroundings photo.
- **Shared Persistent Reviews & Likes (`js/components/ReviewSection.js`, `/api/reviews`)**
  - Shared backend powering both the public homepage Reviews drawer and the authenticated `Reviews` view.
  - Enforces **one review per account** (with author **Edit** and **Delete** controls verified on the server) and **one like per user per review**, sorting reviews by highest like count first and newest first on ties.
- **Profile Affiliation & Private Profile Picture (`Profile`)**
  - Synchronizes the user's public display name, **Campus affiliation** (`Student` or `Staff`, defaulting to `Select your affiliation` until chosen), and **Profile picture** (`Upload photo`, `Take photo` camera capture, and `Remove photo`) with `public.profiles`.
  - Validates `JPEG`, `PNG`, and `WebP` formats up to `5 MB`, center-crops/resizes for avatar display, and strips EXIF/GPS location metadata.
- **Role-Based Staff Controls (`Staff Controls`, `/api/staff/*`)**
  - Protected administrative interface and API routes restricted to authorized staff accounts (`403 Forbidden` for regular users) for managing parking lots, vehicle sections, QR codes, availability statuses, freshness thresholds, and user section reports.

---

## Technology Stack

- **Frontend**: Semantic HTML5 ([`index.html`](./index.html)), modern CSS3 ([`css/styles.css`](./css/styles.css)), and vanilla JavaScript ES Modules ([`js/main.js`](./js/main.js)).
- **Authentication & User Profiles**: **Supabase Auth** and **Supabase PostgreSQL (`public.profiles`)** via `@supabase/supabase-js` ([`js/services/supabaseClient.js`](./js/services/supabaseClient.js), [`js/services/authService.js`](./js/services/authService.js), [`supabase/migrations/001_create_profiles.sql`](./supabase/migrations/001_create_profiles.sql)).
- **Backend Server**: Node.js HTTP server ([`server.mjs`](./server.mjs)) with Supabase JWT verification (`supabase.auth.getUser`) and zero local file/folder data storage.

---

## Prerequisites & Installation

### Prerequisites
- **Node.js** `v18.0.0` or newer and `npm`.
- A Supabase project configured with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### Installation & Startup
1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/NandaKishoreSomisetti/INT_335.git
   cd INT_335
   npm install
   ```
2. Copy `.env.example` to `.env` and configure your Supabase keys:
   ```bash
   cp .env.example .env
   ```
3. Run the SQL migration in your Supabase SQL Editor:
   - Execute [`supabase/migrations/001_create_profiles.sql`](./supabase/migrations/001_create_profiles.sql) in the Supabase Dashboard SQL Editor to create `public.profiles`, enable Row Level Security (RLS), and attach the automatic `on_auth_user_created` user-mirroring trigger.
4. Start the local server:
   ```bash
   npm start
   ```
5. Open `http://localhost:3000` in your browser.

---

## Environment Configuration

Copy [`.env.example`](./.env.example) to `.env`:

```env
# Supabase Configuration (Required for Authentication & Profile Persistence)
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-publishable-or-anon-key

# Server Configuration (Optional)
PORT=3000
STAFF_EMAILS=parktrace.1341@gmail.com
```

---

## Project Structure

```text
INT_335/
├── assets/
│   ├── hero-car-clean.jpg                   # Cleaned studio hero background image
│   └── parktrace-logo.png                   # Official PARKTRACE parking emblem (RGBA PNG)
├── css/
│   └── styles.css                           # Public homepage & authenticated Cinematic Hub styles
├── js/
│   ├── components/
│   │   ├── AuthPanel.js                     # Login & Sign-up glass form component
│   │   ├── BrandLogo.js                     # Shared official PARKTRACE logo renderer
│   │   ├── CinematicHub.js                  # Authenticated Hub (Overview, Find, Vehicle, Reviews, Profile, Staff)
│   │   ├── Header.js                        # Public homepage top-right header (Reviews & Support)
│   │   ├── ReviewCard.js                    # Individual review card with like & owner edit/delete controls
│   │   ├── ReviewSection.js                 # Shared reviews list and composer (public & hub modes)
│   │   └── SupportModal.js                  # Accessible Support dialog (<dialog closedby="any">)
│   ├── services/
│   │   ├── authService.js                   # Supabase Auth & public.profiles synchronization service
│   │   ├── parkingService.js                # Parking discovery, recommendation engine, sessions & staff client
│   │   ├── reviewService.js                 # Shared reviews & likes API client with cross-view pub/sub
│   │   └── supabaseClient.js                # @supabase/supabase-js client initialization & adaptive storage
│   ├── utils/
│   │   └── validation.js                    # Accessible post-interaction form validation helpers
│   ├── config.js                            # Centralized Supabase & API configuration constants
│   └── main.js                              # Application entrypoint & public/authenticated view coordinator
├── supabase/
│   └── migrations/
│       └── 001_create_profiles.sql          # SQL migration for public.profiles, RLS policies & auth trigger
├── .env.example                             # Template environment variables for Supabase & server config
├── .gitignore                               # Excludes .env, logs, and node_modules/
├── index.html                               # Main application HTML document
├── package.json                             # Project metadata and @supabase/supabase-js dependency
├── README.md                                # Project documentation
└── server.mjs                               # Node.js HTTP server & Supabase-verified REST API
```

---

## Support

For project questions or support inquiries, contact:  
**[parktrace.1341@gmail.com](mailto:parktrace.1341@gmail.com)**
