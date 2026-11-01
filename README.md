# INT_335
Where did i park

# PARKTRACE — Campus Vehicle Parking & Retrieval

<p align="left">
  <img src="./assets/parktrace-logo.png" alt="PARKTRACE emblem" width="64" height="64" />
</p>

**Tagline:** *Park smart. Find your way back.*  
**Short description:** *Smarter campus parking. Less searching, easier returns.*

**PARKTRACE** is a campus vehicle parking discovery and parked-vehicle retrieval web application. It helps students, faculty, and staff find compatible parking sections around academic blocks for **bikes (two-wheelers)**, **cars**, and **other campus-approved vehicles**, and record their parked location so they can easily return to their vehicle later.

---

## Visual Preview

![PARKTRACE public homepage background studio composition](./assets/hero-car-clean.jpg)

---

## Feature Overview & Implementation Status

### Completed Features
- **Public Homepage (`index.html`)**
  - Responsive single-screen hero composition with the official PARKTRACE emblem (`./assets/parktrace-logo.png`), editorial brand lockup, glass authentication panel (`Log in` and `Sign up` tabs), accessible Support modal (`<dialog closedby="any">`), and a compact click-to-reveal **Reviews** section.
  - Device-level **Remember me** convenience that remembers only the user's email address in `localStorage` and never stores raw passwords on the client.
- **Session Authentication & Security (`server.mjs`, `js/services/authService.js`)**
  - Password hashing with Node.js `crypto.scryptSync` and per-user random salts, verified with `crypto.timingSafeEqual`.
  - Server-managed sessions using `HttpOnly`, `SameSite=Lax` cookies (`parktrace_sid`), per-IP/per-user rate limiting, intended post-login destination preservation (e.g., returning to `Reviews` when sign-in starts from the public review prompt), and `popstate`/`pageshow` guards preventing browser Back navigation from restoring protected views after sign-out.
- **Authenticated Cinematic Hub & Glass Navigation Bar (`js/components/CinematicHub.js`)**
  - Floating horizontal glass navigation bar with the official logo and `PARKTRACE` wordmark on the left, primary views (`Overview`, `Find Parking`, `My Vehicle`, `Reviews`), and secondary controls on the right (`Staff Controls` for authorized staff only, `Support`, `Profile`, and `Log out` last). Includes an accessible collapsible mobile menu and `@supports` fallback styling when `backdrop-filter` is unavailable.
- **Overview Dashboard**
  - Adapts to the user's active parking state: prioritizes **Find parking** when no vehicle is saved, and highlights the saved vehicle summary with **Find my vehicle**, **Correct location**, and **I’ve left** actions when an active parking session exists.
- **Campus Parking Discovery (`Find Parking`)**
  - Filters configured parking sections by **vehicle type** (`bike`, `car`, `other`) and **destination / academic block**.
  - Displays each section's parent lot, short code, accepted vehicle types, nearby destination, entrance location, capacity/space information, permit restrictions, current availability status (`Available`, `Limited`, `Full`, `Closed`, `Unknown`), last-updated timestamp, and source attribution.
  - Automatically recommends open alternative compatible sections when all primary sections for a selected destination are `Full` or `Closed`.
  - Supports alphanumeric section/QR code lookup and toggles between a section list view and a verified-coordinate map handoff view.
- **Parked-Vehicle Memory Aid & Retrieval (`My Vehicle`)**
  - Saves a private parking record structured as **Parking Lot → Vehicle Section → Row → Bay**, along with vehicle type, parking timestamp, optional landmark note, optional on-demand GPS coordinates (`navigator.geolocation`), and an optional private surroundings photo.
  - Supports QR-assisted section preselection via on-demand camera scanning or manual code entry.
  - Prompts the user to confirm whether their vehicle is still parked when a session exceeds the stale-session threshold (default `12` hours) without automatically deleting the saved location.
- **Shared Persistent Reviews & Likes (`js/components/ReviewSection.js`, `/api/reviews`)**
  - Shared backend powering both the public homepage Reviews drawer and the authenticated `Reviews` view.
  - Enforces **one review per account** (with author **Edit** and **Delete** controls verified on the server) and **one like per user per review**, sorting reviews by highest like count first and newest first on ties.
- **Profile Affiliation & Private Profile Picture (`Profile`)**
  - Supports updating the user's public display name (automatically synchronized to the author's published review).
  - Includes a **Campus affiliation** selector (`Student` or `Staff`, defaulting to `Select your affiliation` until chosen).
  - Includes a compact **Profile picture** control above the display name with a circular avatar preview, initials-based placeholder when no photo is saved, **Upload photo**, **Take photo** (camera capture modal with `Capture`, `Retake`, `Use photo`, and `Cancel`), and **Remove photo**.
  - Validates `JPEG`, `PNG`, and `WebP` formats up to `5 MB` on both client and server, center-crops/resizes for avatar display, strips EXIF/GPS location metadata, preserves the previous saved photo if a replacement upload fails, and restricts photo access strictly to the account owner (`/api/auth/profile/photo`).
- **Role-Based Staff Controls (`Staff Controls`, `/api/staff/*`)**
  - Protected administrative interface and API routes restricted to authorized staff accounts (`403 Forbidden` for regular users) for creating and editing parking lots and vehicle sections, assigning QR codes, updating section availability or closures, adjusting the availability freshness window, reviewing user-submitted section reports, and inspecting the status-update audit log.

### Partially Implemented / Operational Dependencies
- **Manual Staff Availability Updates**: Parking section availability statuses and optional space counts are maintained through staff updates in `Staff Controls`. The project does not include hardware bay sensors, IoT gates, or automated camera occupancy detection.
- **Email Verification Delivery**: The server supports an optional email-verification requirement flag (`PARKTRACE_REQUIRE_EMAIL_VERIFICATION`), but no external SMTP or transactional email service is connected by default.
- **Browser Camera QR Detection**: In-browser QR frame decoding uses the native Web `BarcodeDetector` API where supported by the browser; on browsers without `BarcodeDetector`, users enter the printed section/QR code manually.

### Planned Roadmap
- Migrate persistence from the local JSON datastore (`data/parktrace-db.json`) to a managed relational database (such as PostgreSQL) and external object storage for multi-instance production deployments.
- Integrate a transactional email provider for account verification and password recovery workflows.
- Add an interactive campus vector map with pedestrian route overlays between academic blocks and section entrances.
- Add a printable QR signage generator for physical section posts.

---

## Technology Stack

- **Frontend**: Semantic HTML5 ([`index.html`](./index.html)), modern CSS3 ([`css/styles.css`](./css/styles.css)), and vanilla JavaScript ES Modules ([`js/main.js`](./js/main.js)). No frontend framework, transpiler, or bundler is required.
- **Backend**: Node.js built-in HTTP and cryptography modules (`node:http`, `node:fs`, `node:crypto`, `node:path`, `node:os`, `node:url`) in [`server.mjs`](./server.mjs). Zero third-party `npm` runtime dependencies.
- **Storage**: Atomic local JSON file storage (`data/parktrace-db.json`) with owner-isolated private image storage in `data/private-photos/` (parked-vehicle surroundings photos) and `data/private-avatars/` (user profile pictures).

---

## Prerequisites & Installation

### Prerequisites
- **Node.js** `v18.0.0` or newer.
- A modern desktop or mobile web browser.

### Installation & Startup
1. Clone the repository and navigate to the project root:
   ```bash
   git clone https://github.com/NandaKishoreSomisetti/INT_335.git
   cd INT_335
   ```
2. Start the local server (no `npm install` step is required):
   ```bash
   node server.mjs
   ```
3. Open the local URL printed in the terminal (default `http://localhost:3000`).

---

## Environment Configuration

`server.mjs` reads optional environment variables at startup. Use variable names with your own values as needed (placeholders shown below):

```bash
# HTTP server port and bind address
PORT=3000
HOST=0.0.0.0

# Path to the local JSON database file (private photo directories are created alongside it)
PARKTRACE_DB_PATH=./data/parktrace-db.json

# Comma-separated list of email addresses granted the administrative "staff" role
PARKTRACE_STAFF_EMAILS=staff_admin@example.edu,parking_ops@example.edu

# Set to "true" only when an email verification workflow is desired
PARKTRACE_REQUIRE_EMAIL_VERIFICATION=false
```

Frontend endpoint paths and asset URLs are centralized in [`js/config.js`](./js/config.js) and can also be overridden at runtime via `window.PARKTRACE_CONFIG`.

---

## Verified Commands

| Task | Command | Notes |
| :--- | :--- | :--- |
| **Start local server** | `node server.mjs` | Serves static assets and `/api/*` endpoints on `http://localhost:3000` (and active LAN interfaces). |
| **Verify server syntax** | `node --check server.mjs` | Validates Node.js ES module syntax without starting the listener. |
| **Production build** | *None required* | Frontend assets are native ES modules and standard CSS served directly. |
| **Lint / Test runner** | *Not configured* | The repository does not use a `package.json` test runner or third-party linter. |

---

## Architecture & Domain Rules

### 1. Authentication, Database & Storage Setup
- On first startup, `server.mjs` automatically creates `data/parktrace-db.json`, `data/private-photos/`, and `data/private-avatars/` if they do not exist. No manual database migration commands are required.
- Direct static HTTP requests to `/data/*` are blocked with `403 Forbidden` so database files and private user uploads can never be fetched as public static assets.

### 2. Authorization Role vs. Profile Campus Affiliation
- **Administrative Role (`user.role`)**: Accounts whose email matches the configured staff allowlist (`PARKTRACE_STAFF_EMAILS` or the designated project support account) receive `role: "staff"`, which unlocks `Staff Controls` in the navigation bar and authorizes `/api/staff/*` API requests. All other accounts receive `role: "member"`.
- **Profile Campus Affiliation (`user.campusAffiliation`)**: In the **Profile** view, users can select **Student** or **Staff** under **Campus affiliation** (unselected accounts display `Select your affiliation`). This field is stored strictly as descriptive profile metadata. **Selecting `Staff` in a user profile does not grant administrative access, parking-management permissions, or restricted parking eligibility.**

### 3. How Parking Availability Is Maintained & Data Limitations
- Campus parking lots and vehicle sections (`bike`, `car`, `other`) are created and maintained by authorized staff in **Staff Controls**.
- Each section's availability status (`Available`, `Limited`, `Full`, `Closed`, `Unknown`) records the update timestamp, staff author, and information source.
- **Freshness Policy**: If a section's status (`Available`, `Limited`, or `Full`) has not been updated within the configured freshness window (`freshnessMinutes`, default `60` minutes), the server automatically marks its effective status as `Unknown` (`isStale: true`) rather than presenting outdated availability as current.
- **No Slot Reservation or Live Sensor Claims**: Viewing a section in PARKTRACE is informational only and does not reserve or guarantee a physical parking bay. User-submitted section issue reports (`/api/reports`) are placed in a staff verification queue and never automatically alter published section availability.

### 4. Saving & Retrieving a Parked Vehicle Location
- When a rider parks on campus, they click **I’ve parked — Save location** (or **I’ve parked here** on a section card) to record:
  1. **Parking Lot** and **Vehicle Section** (selected from configured sections, preselected via a section QR code, or entered manually if no sections are configured).
  2. **Row** and **Bay / Spot** identifiers (where marked).
  3. **Vehicle type** (`bike`, `car`, or `other`), optional vehicle label, and parking time.
  4. Optional **GPS pin** (requested via `navigator.geolocation` only when the user clicks **Use current GPS pin**) and optional **landmark note**.
  5. Optional **private surroundings photo** (`GET /api/sessions/:id/photo`), accessible only to the session owner (`403 Forbidden` for any other user).
- Saving, updating (**Correct location**), or ending (**I’ve left**) a personal parking session is a private retrieval memory aid and never modifies section-wide occupancy counts.

### 5. Shared Persistent Reviews & Likes
- Both the public homepage **Reviews** section and the authenticated **Reviews** view read and write to `/api/reviews`.
- Signed-in users can publish one review per account under **"Share your parking experience"**, edit or delete their own review, and toggle one like per review.
- Public visitors can browse all published reviews (sorted by like count descending, then newest first); attempting to post or like while signed out prompts the user to log in and returns them to `Reviews` afterward.

### 6. Profile Picture Privacy & Camera Lifecycle
- Inside **Profile → Account Information**, users can upload a `JPEG`, `PNG`, or `WebP` image (up to `5 MB`) or capture a photo using their device camera.
- Camera permission is requested only when the user clicks **Take photo**. The camera stream is stopped immediately after clicking **Capture**, when clicking **Cancel** or closing the dialog, or when navigating away from the view.
- Uploaded and captured images are center-cropped, resized for avatar display (`<= 512×512`), stripped of EXIF/GPS location metadata on both client and server, and stored privately in `data/private-avatars/`. Failed uploads preserve the user's previously saved profile picture. Profile photos are private to the account owner and are never displayed on public reviews.

---

## Project Structure

```text
INT_335/
├── assets/
│   ├── hero-car-clean.jpg        # Cleaned studio hero background image
│   └── parktrace-logo.png        # Official PARKTRACE parking emblem (RGBA PNG)
├── css/
│   └── styles.css                # Public homepage & authenticated Cinematic Hub styles
├── js/
│   ├── components/
│   │   ├── AuthPanel.js          # Login & Sign-up glass form component
│   │   ├── BrandLogo.js          # Shared official PARKTRACE logo renderer
│   │   ├── CinematicHub.js       # Authenticated Hub (Overview, Find, Vehicle, Reviews, Profile, Staff)
│   │   ├── Header.js             # Public homepage top-right header (Reviews & Support)
│   │   ├── ReviewCard.js         # Individual review card with like & owner edit/delete controls
│   │   ├── ReviewSection.js      # Shared reviews list and composer (public & hub modes)
│   │   └── SupportModal.js       # Accessible Support dialog (<dialog closedby="any">)
│   ├── services/
│   │   ├── authService.js        # Session auth, Remember-me email storage, and profile API client
│   │   ├── parkingService.js     # Parking discovery, recommendation engine, sessions & staff client
│   │   └── reviewService.js      # Shared reviews & likes API client with cross-view pub/sub
│   ├── utils/
│   │   └── validation.js         # Accessible post-interaction form validation helpers
│   ├── config.js                 # Centralized API endpoints, asset paths & contact constants
│   └── main.js                   # Application entrypoint & public/authenticated view coordinator
├── .gitignore                    # Excludes runtime data/, .env files, logs, and node_modules/
├── index.html                    # Main application HTML document
├── README.md                     # Project documentation
└── server.mjs                    # Zero-dependency Node.js HTTP server & REST API
```

---

## Known Limitations

- **Single-Node File Storage**: Runtime state is stored in `data/parktrace-db.json` and local private photo directories on disk, which is designed for local execution and single-process demonstrations rather than horizontally scaled cloud deployments.
- **Staff-Entered Availability**: Section statuses reflect the latest staff update within the configured freshness window rather than real-time physical sensor telemetry.
- **HTTPS Requirement for Camera & Geolocation on Non-Localhost Origins**: Browser `getUserMedia` (camera) and `navigator.geolocation` APIs work on `http://localhost:3000`, but require a secure `https://` origin when accessed over a network IP on mobile devices.

---

## Support

For project questions or support inquiries, contact:  
**[parktrace.1341@gmail.com](mailto:parktrace.1341@gmail.com)**
