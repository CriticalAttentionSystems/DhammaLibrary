import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const videoId = /^[A-Za-z0-9_-]{11}$/;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
export function validateCatalog(catalog) {
  if (catalog.version !== 1 || typeof catalog.complete !== 'boolean' || !Array.isArray(catalog.videos) || !Array.isArray(catalog.warnings)) throw new Error('Invalid discovery catalog.');
  if (!validDate(catalog.scope?.since) || !validDate(catalog.scope?.until) || catalog.scope.since > catalog.scope.until || !Number.isInteger(catalog.scope.months) || catalog.scope.months < 1) throw new Error('Invalid discovery date range.');
  if (!Number.isFinite(Date.parse(catalog.checkedAt))) throw new Error('Invalid discovery scan time.');
  const ids = new Set();
  for (const video of catalog.videos) {
    if (!videoId.test(video.youtubeId) || ids.has(video.youtubeId)) throw new Error('Invalid or duplicate discovery video ID.');
    ids.add(video.youtubeId);
    if (typeof video.title !== 'string' || !video.title.trim() || typeof video.reason !== 'string' || !['eligible','review','excluded'].includes(video.classification)) throw new Error('Invalid discovery description.');
    if (video.type !== null && !['Dhamma talk','Q&A'].includes(video.type)) throw new Error('Invalid discovery talk type.');
    if (video.date !== null && !validDate(video.date)) throw new Error('Invalid discovery date.');
    if (video.url !== `https://www.youtube.com/watch?v=${video.youtubeId}`) throw new Error('Invalid discovery URL.');
  }
  return catalog;
}
export function validateDecisions(decisions) {
  const ids = new Set();
  for (const review of decisions) {
    if (!videoId.test(review.youtubeId) || ids.has(review.youtubeId)) throw new Error('Invalid or duplicate discovery decision ID.');
    ids.add(review.youtubeId);
    if (!['eligible','excluded'].includes(review.decision) || typeof review.reason !== 'string' || !review.reason.trim()) throw new Error('Discovery decisions need a decision and reason.');
    if (review.decision === 'eligible' && !['Dhamma talk','Q&A'].includes(review.type)) throw new Error('An eligible talk needs a type.');
    if (review.duplicateOf && (!videoId.test(review.duplicateOf) || review.duplicateOf === review.youtubeId || review.decision !== 'excluded')) throw new Error('A duplicate must point to a different video and be excluded.');
  }
  return decisions;
}
export async function readContributionData(root) {
  let catalog;
  try { catalog = validateCatalog(JSON.parse(await readFile(path.join(root,'content/discovery.json'),'utf8'))); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    catalog = {version:1,complete:false,scope:null,checkedAt:null,videos:[],warnings:['The channel has not been scanned yet.']};
  }
  let files=[];
  try { files = (await readdir(path.join(root,'content/discovery-reviews'))).filter(f=>f.endsWith('.json')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const reviews = validateDecisions(await Promise.all(files.map(async file=>JSON.parse(await readFile(path.join(root,'content/discovery-reviews',file),'utf8')))));
  return {catalog,reviews};
}
