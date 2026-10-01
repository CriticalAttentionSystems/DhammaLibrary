# Bhante G Dhamma Library

A responsive reading library containing ten recent Bhante Gunaratana Dhamma talks and Q&A sessions, concise overviews, longer summary popups, individual reading pages, the supplied Ānāpānasati manuscript PDF, and the narrated Ānāpānasati video. The initial collection spans August 29–September 27, 2026. Pali classes are excluded.

The public site is ready to upload to Netlify. Shared editing is implemented with Decap CMS, GitHub Open Authoring, and a review workflow. **Live shared sign-in is not connected yet:** it needs your GitHub repository and Netlify OAuth setup. No credentials are included.

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
5. Test `/admin/` as the owner and with a contributor account before inviting people. This final account-dependent authentication test remains outstanding.

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

## Files to customize

The Contribute section includes optional StillWord 1.0.0 downloads for Apple silicon and Intel Macs, clearly labeled as unsigned test builds. Installers are hosted on the [StillWord v1.00 GitHub release](https://github.com/CriticalAttentionSystems/StillWord/releases/tag/v1.00), not bundled with the website. The published Intel asset is named `StillWord-1.0.0-Intel--unsigned.dmg` (two hyphens before `unsigned`); preserve that exact URL. Update the links in `templates/index.html` when a new release is published. The shared editor remains the main contribution route.

| Purpose | File or folder |
| --- | --- |
| Page structure and book information | `templates/index.html` |
| Colors, layout, type sizes | `public/assets/site.css` |
| Search, filters, summary popups | `public/assets/site.js` |
| Talk content | `content/talks` |
| Shared-editor fields | `templates/admin-config.yml` |
| Book PDF and artwork | `public/assets/books` |
| Narrated video and poster | `public/assets/video` |
| Build and validation | `scripts/build.mjs`, `scripts/content.mjs` |
| Separate concise/Auto text exports | `summaries` |

The 31 MB video is included locally and does not autoplay. Video viewing uses your Netlify bandwidth; monitor the site's usage as the audience grows. The supplied PDF, The Ānāpānasati Sutta: A Path to Awakening by Bhante Gunaratana, has 154 pages (13.3 MB). It is copied unchanged and retains its contents links.

## Validation

```sh
npm test
npm run build
```

Automated checks cover content validation, safe summary rendering, unpublished entries, duplicate videos, and video range requests. Browser checks verified filtering, search, empty results, summary popups and keyboard closing, all ten reading pages, PDF delivery, video playback and seeking, and layouts at desktop, 390 px, and 320 px widths. Production GitHub login and contributor pull requests require the live account setup above.

Developer and curator: Veronique — [Critical Attention Systems](https://criticalattentionsystems.org) — criticalattentionsystems@gmail.com.

Hosting references: [Netlify deployments](https://docs.netlify.com/deploy/create-deploys/), [Decap GitHub backend](https://decapcms.org/docs/github-backend/), [Open Authoring](https://decapcms.org/docs/open-authoring/).
