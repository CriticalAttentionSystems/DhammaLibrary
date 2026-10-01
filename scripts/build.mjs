import { readFile, writeFile, readdir, mkdir, cp, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readContributionData } from './contribution-data.mjs';
import { escapeHtml as e, prepareTalks } from './content.mjs';
import { latestTalks, selectTalks, talkRow, pagination, archiveUrl } from '../public/assets/talks.js';

const root = fileURLToPath(new URL('../',import.meta.url));
const dist = path.join(root,'dist');
const talkDir = path.join(root,'content/talks');
const files = (await readdir(talkDir)).filter(file => file.endsWith('.json'));
const raw = await Promise.all(files.map(file => readFile(path.join(talkDir,file))));
const records = raw.map(bytes=>JSON.parse(bytes.toString('utf8')));
const talks = prepareTalks(records);
const library = records.map((record,i)=>({path:`content/talks/${files[i]}`,blobSha:createHash('sha1').update(`blob ${raw[i].length}\0`).update(raw[i]).digest('hex'),youtubeId:record.youtubeId,published:record.published,...(record.published ? {id:record.id,title:record.title,type:record.type} : {})}));
const contributionData = await readContributionData(root);
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
const template = await readFile(path.join(root,'templates/index.html'),'utf8');
const latest = latestTalks(talks);
await writeFile(path.join(dist,'index.html'),template.replace('{{COUNT}}',latest.length).replace('{{TALK_ROWS}}',latest.map(talkRow).join('\n')).replace('{{CANONICAL}}',canonical('/')));
const archiveTemplate = await readFile(path.join(root,'templates/talks.html'),'utf8');
const footer = template.match(/<footer class="site-footer[\s\S]*?<\/footer>/)[0];
const queueTemplate = await readFile(path.join(root,'templates/contribute-talks.html'),'utf8');
const queueData = JSON.stringify({repository,library,...contributionData}).replaceAll('<','\u005cu003c');
await mkdir(path.join(dist,'contribute/talks'),{recursive:true});
await writeFile(path.join(dist,'contribute/talks/index.html'),queueTemplate.replace('{{QUEUE_DATA}}',queueData).replace('{{FOOTER}}',footer).replace('{{CANONICAL}}',canonical('/contribute/talks/')));
const summaryDialog = template.match(/  <dialog[\s\S]*?(?=<\/body>)/)[0];
const archiveUrls = [];
const archiveFilters = {q:'',from:'',to:'',type:'all',page:1};
const pageCount = selectTalks(talks,archiveFilters).pages;
for (let page = 1; page <= pageCount; page++) {
  const filters = {...archiveFilters,page};
  const result = selectTalks(talks,filters);
  const url = archiveUrl(filters);
  archiveUrls.push(url);
  const dir = path.join(dist,url); await mkdir(dir,{recursive:true});
  const html = archiveTemplate.replace('{{PAGE_TITLE}}',page > 1 ? ` · Page ${page}` : '').replace('{{COUNT}}',result.total)
    .replace('{{TALK_ROWS}}',result.items.map(talkRow).join('\n')).replace('{{PAGINATION}}',pagination(result,filters))
    .replace('{{PAGE_STATUS}}',`${result.start+1}–${result.start+result.items.length} of ${result.total} talks · Page ${result.page} of ${result.pages}`)
    .replace('{{CANONICAL}}',canonical(url)).replace('{{FOOTER}}',footer).replace('{{SUMMARY_DIALOG}}',summaryDialog);
  await writeFile(path.join(dir,'index.html'),html);
}
for (const talk of talks) {
  const dir = path.join(dist,talk.readingUrl); await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'index.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(talk.title)} · Dhamma Library</title><meta name="description" content="${e(talk.brief)}"><link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="/assets/site.css">${canonical(talk.readingUrl)}</head><body><main class="reading-page wrap"><a class="back-link" href="/talks/">← Browse all talks</a><p class="eyebrow">${e(talk.type)} · ${e(talk.dateLabel)} · BHANTE GUNARATANA</p><h1>${e(talk.title)}</h1><p class="intro">${e(talk.brief)}</p><div class="dialog-actions"><a class="button primary" href="${e(talk.url)}" target="_blank" rel="noopener">Watch on YouTube ↗</a></div><article class="prose">${talk.summaryHtml}</article><p class="summary-note">Summary prepared with AI assistance and edited against the transcript. Refer to the recording for the original teaching. Original video title: ${e(talk.originalTitle)}. <a href="mailto:criticalattentionsystems@gmail.com">Suggest a correction</a>.</p></main></body></html>`);
}
if (repository && origin) {
  const config = (await readFile(path.join(root,'templates/admin-config.yml'),'utf8')).replaceAll('__GITHUB_REPOSITORY__',repository).replaceAll('__SITE_URL__',origin);
  JSON.parse(config); await writeFile(path.join(dist,'admin/config.yml'),config);
}
await writeFile(path.join(dist,'robots.txt'),`User-agent: *\nDisallow: /admin/\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ''}`);
if (origin) await writeFile(path.join(dist,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/',...archiveUrls,...talks.map(talk=>talk.readingUrl)].map(url=>`<url><loc>${e(origin+url)}</loc></url>`).join('')}</urlset>`);
await writeFile(path.join(dist,'404.html'),'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found · Dhamma Library</title><link rel="stylesheet" href="/assets/site.css"></head><body><main class="reading-page wrap"><h1>That page is not in the library.</h1><p>Return to the collection to find a talk, the book, or the breathing presentation.</p><a class="button primary" href="/">Open the library</a></main></body></html>');
console.log(`Built ${talks.length} talks and reading pages in ${dist}\nShared editor: ${repository && origin ? 'repository configured; Netlify OAuth must be connected' : 'setup page (GitHub repository and site URL not yet configured)'}`);
