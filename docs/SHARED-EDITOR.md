# Shared editor

The public library is a static site. The editor at `/admin/` uses **Decap CMS 3.15.1**, bundled locally, with GitHub as its content store. A GitHub account is required. Authentication has not been connected or verified for a live account; the repository and deployment address must first be chosen.

## Connect the live editor

1. Put this project in a **public GitHub repository** with a `main` branch. The repository must contain the project itself at its root, including `content/talks` and `public`. Keep drafts free of private material: forks and pull requests are public.
2. Connect that repository to a Netlify project. Use `npm run build` as the build command and `dist` as the publish directory. The included `netlify.toml` already sets these and Node 22. Set the build environment variables `GITHUB_REPOSITORY` to `owner/repository` and `SITE_URL` to the HTTPS origin of the live site, without a trailing slash. Redeploy after changing either value. These are public settings, not credentials.
3. In GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App**. Give it a recognizable name and the live site homepage. Set its **Authorization callback URL** to `https://api.netlify.com/auth/done`.
4. Copy the OAuth Client ID and generate a Client Secret. Enter both in **Netlify → Project configuration → Security → OAuth → Authentication Providers → Install Provider → GitHub**. Enter the secret there yourself; never put it in a file, browser script, build environment variable, pull request, or message. See [Netlify's OAuth setup](https://docs.netlify.com/manage/security/secure-access-to-sites/oauth-provider-tokens/).
5. Visit the live site's `/admin/` and sign in with GitHub. Test once as the owner, then with a separate contributor account. Confirm that the contributor can submit a draft for review and cannot publish it. Review the resulting pull request before merging it. The full authentication and fork/pull-request flow needs this live verification.

This configuration uses the [GitHub backend](https://decapcms.org/docs/github-backend/), not Git Gateway. Netlify's OAuth provider connects the GitHub login to the CMS; a Netlify Identity account is not needed. If the site moves to another host, replace the OAuth server configuration with a supported provider rather than assuming Netlify login will continue to work.

## Contribute and review

Contributors open `/admin/`, log in with GitHub, choose **Talks**, and create or edit an entry. Keep the entry ID stable. Enter the original title and YouTube ID accurately; use the full watch URL. Summaries should be checked against the recording, including ambiguous Pali words.

With [Open Authoring](https://decapcms.org/docs/open-authoring/), outside contributors work in their own forks. Saving creates a draft there. Moving it to **Ready to Review** submits a pull request to the library repository. These outside contributions are reviewed and merged in GitHub by the maintainer; they do not appear in the owner's CMS workflow board. Contributors without repository write access cannot publish through the CMS. Give write access only to trusted maintainers.

New entries default to `published: false`. This flag is an additional public-listing gate, not a permission system. The reviewer checks the complete change, sets the flag to `true` only when ready, and merges into `main`. Deployment rebuilds the public library. The build must exclude entries whose `published` value is not exactly `true`. To remove a talk from public listing, set it to `false` and merge/redeploy.

Existing published talks stay visible while a correction is under review; unmerged edits do not change the live version. Configure GitHub branch rules if owner approval must be enforced for other maintainers with write access.

## Build contract

`templates/admin-config.yml` is strict JSON, which is valid YAML. Replace only `__GITHUB_REPOSITORY__` and `__SITE_URL__`, validate their values, and write `dist/admin/config.yml`. Do not emit a configuration with placeholder values. When either value is missing, leave the config absent: the editor shows an explicit setup notice, while the public library still works.

Copy all of `public/admin/` into `dist/admin/`. The only runtime library is `vendor/decap-cms-3.15.1.js`; no live CDN or package installation is needed to load the editor. Version, source URL, SHA-256, and license notices are recorded next to the bundle. A version upgrade is a deliberate change followed by another editor test.

The folder collection reads and writes JSON under `content/talks`. Fields are `id`, `youtubeId`, `url`, optional `thumbnailUrl`, `title`, `originalTitle`, `date`, `type`, `durationSeconds`, `topics`, `brief`, `summaryMarkdown`, and `published`. Filenames are generated from `id`. The thumbnail field may be blank. When present, use an observed HTTPS `i.ytimg.com/vi/VIDEO_ID/…` address or an existing local frame at `/assets/images/talks/VIDEO_ID.jpg` for that exact video. The build validates the video ID and requires local image files to exist. No production credentials belong in this data.

## Local preview and verification

Serve the built site on localhost and visit `/admin/?demo=1`. This opt-in mode is allowed only for `localhost`, `127.0.0.1`, and IPv6 loopback. It uses Decap's [test backend](https://decapcms.org/docs/test-backend/) and a persistent on-screen warning. Its entries exist only in the current tab: reloading discards them. It cannot access the filesystem, GitHub, or live content, and is not a substitute for production authentication.

To check the editing flow, log in to the test backend, create a talk, fill all required fields, leave public approval off, and save. Confirm its status is Draft and that the public library is unchanged. Reload to clear the fixture. Browser verification covered local login, creating and editing a saved draft, draft status, unchanged public content, and clearing the temporary data by reloading. The production GitHub authentication and fork/pull-request flow remain unverified until the live account setup is completed. Bootstrap behavior, configuration schemas, and vendor integrity are included in `npm test`.

If `/admin/` reports setup is incomplete, check the two build settings and generated config. If GitHub login fails, check the live site's OAuth provider, the exact callback URL, popup blocking, and repository access. Do not grant broad permissions or share a personal access token to work around a misconfigured login.
