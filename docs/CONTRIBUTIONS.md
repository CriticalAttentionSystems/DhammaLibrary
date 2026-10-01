# Find and coordinate missing talks

Open **Contribute → Find a talk to contribute**, at `/contribute/talks/`.

The initial channel scan covers April 1–October 1, 2026. It reads public metadata from Bhavana Society's Videos and Live tabs, deduplicates by case-sensitive YouTube video ID, and compares with the library. It does not download recordings, create summaries, or publish entries. The current catalog has 127 videos: 10 already published, 25 candidate talks, 60 needing identification, and 32 exclusions, including the Pali class previously identified by the editor.

Dates are YouTube broadcast dates when present, otherwise upload dates, in UTC. They can differ from the date a talk was given, particularly for reuploads. Generic titles are not enough to identify the speaker: these remain **Needs review**. Watch enough of a candidate to confirm the speaker and subject before preparing it. Private, unlisted, deleted, and members-only videos are outside the guaranteed inventory. Different IDs for the same teaching need human review.

## Contributor steps

1. Search the list and check its status. On opening or refreshing the page, it reads the latest main-branch inventory, open reservations, and open pull requests from GitHub. Published talks, drafts already on main, and open submissions cannot be reserved again.
2. Choose **Reserve this talk** (or **Reserve for review** for an uncertain recording). The page checks again, then offers a GitHub reservation form. Sign in and submit that form, preserving its `[Talk claim] VIDEO_ID` title and video ID.
3. Return and click **Check contributions**. Start only when your GitHub username appears. If two people request the same video, the earliest currently open issue has priority; the later requester should close their request and choose another talk. This is a visible coordination process, not an atomic lock.
4. Prepare the transcript and both summaries, then use **Open shared editor**. Enter the exact video ID and submit the draft for review. External contributors' unsubmitted fork drafts are invisible to others, which is why the reservation comes first.
5. Close your reservation after publication, or if you stop working. The owner can close abandoned reservations after checking with the contributor. No reservation expires automatically.

If GitHub's public API is unavailable, rate limited, or returns an incomplete inventory, the page disables reservation buttons. Check the repository's issues and pull requests directly or try later. No API key is put in the browser. A refresh checks contributions; it does not rescan YouTube.

## Resolve uncertain videos and reuploads

In the shared editor, open **Discovery decisions**. Enter the exact YouTube ID, choose `eligible` or `excluded`, and explain the reason. Eligible decisions need the correct talk type. To exclude a reupload, also fill **Already covered by video ID** with the original video's ID. Decisions pass through the existing review workflow and survive later channel scans. JSON files live in `content/discovery-reviews/`.

For a new talk, leave **Approved for public listing** off until the owner has reviewed it. Correct existing entries in place; do not create a second entry for the same video. The static build rejects duplicate entry IDs or video IDs, including unpublished entries.

## Refresh or extend the scan

Use Node.js 22+ and an installed, current `yt-dlp`. From the project directory:

```sh
npm run scan:talks -- --months 6
npm test
npm run build
```

If `yt-dlp` is not on PATH, add `--yt-dlp /opt/homebrew/bin/yt-dlp` or its actual installed location. Use `--months 12` to extend the range, or `--as-of YYYY-MM-DD` for a reproducible end date. The scanner reads at most 400 listings per tab by default, with a 62-day buffer for approximate listing dates, then verifies candidate dates individually. If the older boundary is not reached, increase `--max-items` (maximum 2000). Incomplete scans cannot overwrite an existing catalog; resolve the failure and retry. A separate `--output` file can retain diagnostic results.

Review `content/discovery.json`, commit the changed files yourself, and push. The connected Netlify deployment updates the site. No scheduled scanner or automatic commit is enabled. The scan date stays visible so contributors can judge freshness.

## Activate the duplicate-submission check

The source includes `.github/workflows/contribution-check.yml`. After these files are committed and pushed to main, pull requests run **Check talk contributions**. This checks the latest main records and earlier open pull requests. It rejects duplicate new videos, permits corrections and renames, and fails rather than approving incomplete API results. The workflow executes only trusted default-branch code; proposed JSON is read as data, with a read-only token. It does not post comments or create issues.

In the repository's branch rule for `main`, require the **Check talk contributions** status check and require branches to be up to date before merging. The check may need to run on a real pull request once before it appears in the selector. These repository settings have not been changed by this update. Until configured, the check is advisory and can be bypassed during a merge. Direct pushes still depend on the build validation. Require review for submissions and review changes to the workflow or checker as code changes.

Test the full reservation and external-contributor submission flow with a contributor account after deployment. Local verification does not create a real issue or pull request. The repository must have Issues enabled for reservations.

References: [yt-dlp](https://github.com/yt-dlp/yt-dlp), [Decap Open Authoring](https://decapcms.org/docs/open-authoring/), [GitHub repository issues API](https://docs.github.com/en/rest/issues/issues#list-repository-issues).
