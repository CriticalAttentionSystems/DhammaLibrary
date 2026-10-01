import { readFile, writeFile, readdir, mkdir, cp, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { escapeHtml as e, prepareTalks } from './content.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const dist = path.join(root,'dist');
const talkDir = path.join(root,'content/talks');
const files = (await readdir(talkDir)).filter(file => file.endsWith('.json'));
const talks = prepareTalks(await Promise.all(files.map(async file => JSON.parse(await readFile(path.join(talkDir,file),'utf8')))));
if (!talks.length) throw new Error('Add at least one approved talk to content/talks before building.');
for (const talk of talks) {
  if (talk.thumbnailUrl?.startsWith('/')) await access(path.join(root,'public',talk.thumbnailUrl));
}
let origin = '';
if (process.env.SITE_URL) {
  const url = new URL(process.env.SITE_URL);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('SITE_URL must be an HTTPS site origin.');
  origin = url.origin;
}
const repository = process.env.GITHUB_REPOSITORY || '';
if (repository && !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY must be owner/repository.');
await rm(dist,{recursive:true,force:true});
await cp(path.join(root,'public'),dist,{recursive:true});
await mkdir(path.join(dist,'data'),{recursive:true});
await writeFile(path.join(dist,'data/talks.json'),JSON.stringify(talks));
const canonical = url => origin ? `<link rel="canonical" href="${e(origin+url)}">` : '';
const duration = seconds => `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
const icon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3h12v14H4zM7 7h6M7 10h6M7 13h4"/></svg>';
const row = talk => `<article class="talk-row" data-type="${e(talk.type)}">
  <div class="talk-source"><a class="thumbnail" href="${e(talk.url)}" target="_blank" rel="noopener" aria-label="Watch ${e(talk.title)}">${talk.thumbnailUrl ? `<img src="${e(talk.thumbnailUrl)}" width="320" height="180" loading="lazy" alt="">` : ''}<span class="duration">${duration(talk.durationSeconds)}</span></a>
  <div><p class="talk-meta"><span class="talk-kind">${e(talk.type)}</span><time datetime="${e(talk.date)}">${e(talk.dateLabel)}</time></p><h3><a href="${e(talk.url)}" target="_blank" rel="noopener">${e(talk.title)}</a></h3><a class="watch-link" href="${e(talk.url)}" target="_blank" rel="noopener">Watch on YouTube ↗</a></div></div>
  <div class="talk-brief"><p>${e(talk.brief)}</p><div class="row-footer"><a class="summary-button" href="${e(talk.readingUrl)}" data-summary="${e(talk.id)}">${icon} Read full summary</a><span class="topic-list">${talk.topics.map(e).join(' · ')}</span></div></div>
</article>`;
const template = await readFile(path.join(root,'templates/index.html'),'utf8');
await writeFile(path.join(dist,'index.html'),template.replace('{{COUNT}}',talks.length).replace('{{TALK_ROWS}}',talks.map(row).join('\n')).replace('{{CANONICAL}}',canonical('/')));
for (const talk of talks) {
  const dir = path.join(dist,talk.readingUrl); await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'index.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(talk.title)} · Dhamma Library</title><meta name="description" content="${e(talk.brief)}"><link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="/assets/site.css">${canonical(talk.readingUrl)}</head><body><main class="reading-page wrap"><a class="back-link" href="/#talks">← Back to the Dhamma Library</a><p class="eyebrow">${e(talk.type)} · ${e(talk.dateLabel)} · BHANTE GUNARATANA</p><h1>${e(talk.title)}</h1><p class="intro">${e(talk.brief)}</p><div class="dialog-actions"><a class="button primary" href="${e(talk.url)}" target="_blank" rel="noopener">Watch on YouTube ↗</a></div><article class="prose">${talk.summaryHtml}</article><p class="summary-note">Summary prepared with AI assistance and edited against the transcript. Refer to the recording for the original teaching. Original video title: ${e(talk.originalTitle)}. <a href="mailto:criticalattentionsystems@gmail.com">Suggest a correction</a>.</p></main></body></html>`);
}
if (repository && origin) {
  const config = (await readFile(path.join(root,'templates/admin-config.yml'),'utf8')).replaceAll('__GITHUB_REPOSITORY__',repository).replaceAll('__SITE_URL__',origin);
  JSON.parse(config); await writeFile(path.join(dist,'admin/config.yml'),config);
}
await writeFile(path.join(dist,'robots.txt'),`User-agent: *\nDisallow: /admin/\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ''}`);
if (origin) await writeFile(path.join(dist,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/',...talks.map(talk=>talk.readingUrl)].map(url=>`<url><loc>${e(origin+url)}</loc></url>`).join('')}</urlset>`);
await writeFile(path.join(dist,'404.html'),'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found · Dhamma Library</title><link rel="stylesheet" href="/assets/site.css"></head><body><main class="reading-page wrap"><h1>That page is not in the library.</h1><p>Return to the collection to find a talk, the book, or the breathing presentation.</p><a class="button primary" href="/">Open the library</a></main></body></html>');
console.log(`Built ${talks.length} talks and reading pages in ${dist}\nShared editor: ${repository && origin ? 'repository configured; Netlify OAuth must be connected' : 'setup page (GitHub repository and site URL not yet configured)'}`);
