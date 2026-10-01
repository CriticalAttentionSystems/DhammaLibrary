# Bhante G Dhamma Library

A responsive reading library with Bhante Gunaratana Dhamma talks and Q&A sessions, concise overviews, longer summary popups, individual reading pages, the supplied Ānāpānasati manuscript PDF, and the narrated Ānāpānasati video. The homepage shows the ten newest published talks by talk date. The complete collection is available at `/talks/`. The initial ten entries span August 29–September 27, 2026. Pali classes are excluded.

The public site builds for Netlify. Shared editing uses Decap CMS, GitHub Open Authoring, and a review workflow. Owner sign-in has been confirmed on the live site; the external-contributor pull-request workflow still needs an account-level test. No credentials are included.

## Browse the collection

The homepage updates automatically after each publication/build; older talks remain in All talks. No manual moving or archiving is needed. The book, video, and contribution workflow are unchanged.

All talks supports keyword search across titles, topics, concise overviews, and full summaries; accents and letter case are ignored. From/To dates include both boundary dates and may be used separately. Dhamma/Q&A filters combine with search and dates. Results are newest first, with ten per page. Filters and the current page are stored in the URL so searches can be bookmarked or shared. Closing a summary popup retains the current results.

Static numbered pages keep the entire collection browsable without JavaScript. Search becomes available after the collection loads; if that fails, the page offers a retry while retaining the static list and page links. Individual summary links remain readable without the popup.

For the connected GitHub/Netlify site, review changes in GitHub Desktop, commit them, and push to `main` to trigger the deployment. There is no separate content migration.

## Find missing talks and avoid duplicate work

Open **Contribute → Find a talk to contribute**. The six-month channel inventory separates available candidates, uncertain videos, exclusions, published talks, reservations, and submissions awaiting review. Contributors reserve a video with GitHub before preparing a summary. The page checks live contributions by the exact YouTube video ID, including unpublished main-branch entries and open pull requests.

See [the contribution guide](docs/CONTRIBUTIONS.md) for the reservation workflow, review decisions, refreshing the scan, and enabling the required duplicate-submission check. Run `npm run scan:talks -- --months 6` to refresh locally, then review, commit, and push the catalog. No scheduled runs or automatic commits are enabled.

## Preview locally

Install Node.js 22 or later, open a terminal in this project directory, then run:

```sh
npm run build
npm run preview
```

Open `http://127.0.0.1:4173`. Stop the server with Control-C. There are no npm dependencies to install; the editor is vendored locally. Open the site through a server rather than double-clicking the HTML file, since links and summary loading use site-root paths.

## Upload the public website now

1. Unzip `DhammaLibrary-Netlify-Upload.zip`.
2. In Netlify, choose the manual deploy/drop option and upload the unzipped `dist` folder. Its root contains `index.html`, `assets`, and `admin`.
3. Open the resulting site and check a summary, the PDF, and the video.

This publishes the reading website. A manual upload alone does not connect contributor logins. If you later update the source manually, rebuild and upload a new `dist` folder.

## Connect the shared browser editor

For ongoing contributions, use the **source project**, not the built `dist` folder:

1. Create an empty public GitHub repository. With GitHub Desktop, add this project as a new repository and publish it to your account. Keep the branch named `main`. The project files must be at the repository root. Do not commit the private `work` or `qa` folders; `.gitignore` excludes them.
2. In Netlify, import that GitHub repository. Build command: `npm run build`. Publish directory: `dist`. Node version: `22`. These settings are also in `netlify.toml`.
3. Add the public build settings `GITHUB_REPOSITORY=your-account/your-repository` and `SITE_URL=https://your-site.netlify.app`. Use your actual repository and site address, then redeploy.
4. Complete the GitHub OAuth app and Netlify provider connection in [the shared-editor setup guide](docs/SHARED-EDITOR.md).
5. Test `/admin/` as the owner and with a contributor account before inviting people. Owner sign-in is confirmed for the current deployment; external-contributor submission and review remain to be tested.

Outside contributors sign in with GitHub, prepare entries in their forks, and submit pull requests for review. You review and merge approved contributions. New entries start with public listing off. The `published` field is a listing control; GitHub permissions and review rules provide access control.

The local editor at `/admin/?demo=1` demonstrates the form without an account. Its temporary drafts disappear when the tab reloads and never change the site.

## Add or edit a talk

Content lives in `content/talks/*.json`. Edit through the shared editor once connected, or edit these files locally and rebuild. Every talk contains its YouTube ID and link, original title, library title, date, category, duration, topics, concise overview, longer Markdown summary, optional thumbnail URL, and publication flag.

The library supports simple Markdown headings, paragraphs, bullet/numbered lists, emphasis, and HTTPS links. Raw HTML is escaped. Keep a blank line between blocks. The build checks dates, video links, category values, duplicate entries, and thumbnails, and excludes unpublished entries.

For reliable summaries:

- Use the complete substantive talk. Preserve actual questions and answers only for Q&A sessions.
- Check both summaries against the transcript and revisit the recording for unclear terms.
- Preserve qualifications and exceptions. Do not guess garbled Pali, names, numbered lists, or unfinished answers.
- Omit opening/closing prayers, recitations, and the closing standalone guided meditation. Retain teaching about those practices within the talk.
- Write in American English and review before publication. The original recording is the source.

The first ten entries were generated using the existing StillWord local model engine and edited against complete transcripts. They are reviewed reading aids, not word-for-word transcripts. Original engine outputs and captions remain in the private working folder, outside the site and distribution archives. No changes were made to StillWord for this website.

## Embedded book reader

Choose **Read the book here** to expand the reader beneath the book and video. It loads only when opened. The reader provides previous/next pages, a page-number field, zoom, text selection, search, and the PDF's existing contents links. **Open in new tab** opens `/book/` at the same page and zoom. Closing and reopening the embedded reader retains its place. Direct PDF opening and downloading remain available as fallbacks.

Replace `public/assets/books/Anapanasati_manuscript.pdf` with the revised manuscript, keeping that exact name, then rebuild and publish. Both readers and the download use that file; the reader calculates its page count from the document. The current PDF and its editorial credits have not been modified. If the cover changes, update `public/assets/books/book-cover.webp` as well.

The viewer is Mozilla PDF.js 6.3.289 (legacy generic build), hosted entirely with this site. Its license, bundled resource licenses, source URL, and integrity manifest are in `public/assets/pdfjs/`. No external PDF-viewing service receives the manuscript. Site-specific styling and reader behavior live outside the vendored code, except for four documented changes to `web/viewer.html`. Keep the matching viewer, worker, fonts, CMaps, and supporting files together when upgrading. The local preview server supplies the required JavaScript-module and WebAssembly MIME types.

## Files to customize

The Contribute section includes optional StillWord 1.0.0 downloads for Apple silicon and Intel Macs, clearly labeled as unsigned test builds. Installers are hosted on the [StillWord v1.00 GitHub release](https://github.com/CriticalAttentionSystems/StillWord/releases/tag/v1.00), not bundled with the website. The published Intel asset is named `StillWord-1.0.0-Intel--unsigned.dmg` (two hyphens before `unsigned`); preserve that exact URL. Update the links in `templates/index.html` when a new release is published. The shared editor remains the main contribution route.

| Purpose | File or folder |
| --- | --- |
| Homepage structure and book information | `templates/index.html` |
| Complete collection page | `templates/talks.html` |
| Colors, layout, type sizes | `public/assets/site.css` |
| Search, filters, summary popups | `public/assets/site.js`, `public/assets/talks.js` |
| Talk content | `content/talks` |
| Shared-editor fields | `templates/admin-config.yml` |
| Book PDF and artwork | `public/assets/books` |
| Embedded reader and pop-out page | `public/assets/book-reader.js`, `public/assets/book-view.js`, `public/book/index.html` |
| Reader setup and visual style | `public/assets/book-viewer-bootstrap.js`, `public/assets/book-viewer.css` |
| Narrated video and poster | `public/assets/video` |
| Build and validation | `scripts/build.mjs`, `scripts/content.mjs` |
| Separate concise/Auto text exports | `summaries` |

The 31 MB video is included locally and does not autoplay. Video viewing uses your Netlify bandwidth; monitor the site's usage as the audience grows. The supplied PDF, The Ānāpānasati Sutta: A Path to Awakening by Bhante Gunaratana, has 157 pages (6.5 MB). It is copied unchanged and retains its contents links.

## Validation

```sh
npm test
npm run build
```

Automated checks cover content validation, safe summary rendering, unpublished entries, duplicate videos, video range requests, and archive filtering/pagination. A build test with 24 published talks verifies the homepage limit, complete numbered archive, reading pages, and sitemap. Browser checks verified filtering, search, empty results, summary popups and keyboard closing, date validation, URL restoration, and layouts at desktop, 390 px, and 320 px widths. Earlier checks covered all ten reading pages, PDF delivery, and video playback/seeking. External-contributor pull requests still need the account-level test above.

Developer and curator: Veronique — [Critical Attention Systems](https://criticalattentionsystems.org) — criticalattentionsystems@gmail.com.

Hosting references: [Netlify deployments](https://docs.netlify.com/deploy/create-deploys/), [Decap GitHub backend](https://decapcms.org/docs/github-backend/), [Open Authoring](https://decapcms.org/docs/open-authoring/).
