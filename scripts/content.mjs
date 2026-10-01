export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function inline(text) {
  // Author content is text, never executable HTML. Only HTTPS links are rendered.
  return text.split(/(\[[^\]\n]+\]\([^\s)]+\))/g).map(part => {
    const link = part.match(/^\[([^\]\n]+)\]\(([^\s)]+)\)$/);
    if (link) {
      let url; try { url = new URL(link[2]); } catch {}
      return url?.protocol === 'https:' ? `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link[1])}</a>` : escapeHtml(link[1]);
    }
    return escapeHtml(part).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  }).join('');
}

export function markdown(text) {
  return String(text).trim().split(/\n\s*\n/).filter(Boolean).map(block => {
    const lines = block.trim().split('\n');
    if (lines.length === 1 && /^#{1,3} /.test(block)) {
      const match = block.match(/^(#{1,3}) (.*)$/); const level = Math.max(2, match[1].length);
      return `<h${level}>${inline(match[2])}</h${level}>`;
    }
    if (lines.every(line => /^[-*] /.test(line))) return `<ul>${lines.map(line => `<li>${inline(line.slice(2))}</li>`).join('')}</ul>`;
    if (lines.every(line => /^\d+\. /.test(line))) return `<ol>${lines.map(line => `<li>${inline(line.replace(/^\d+\. /, ''))}</li>`).join('')}</ol>`;
    return `<p>${inline(lines.join(' '))}</p>`;
  }).join('\n');
}

export function validateTalk(talk, file = 'entry') {
  const fail = reason => { throw new Error(`${file}: ${reason}`); };
  if (typeof talk.published !== 'boolean') fail('published must be true or false');
  if (typeof talk.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(talk.id)) fail('invalid entry ID');
  if (!/^[A-Za-z0-9_-]{11}$/.test(talk.youtubeId)) fail('invalid YouTube video ID');
  let url; try { url = new URL(talk.url); } catch { fail('invalid YouTube URL'); }
  if (url.protocol !== 'https:' || !['www.youtube.com','youtube.com'].includes(url.hostname) || url.pathname !== '/watch' || url.searchParams.get('v') !== talk.youtubeId) fail('video URL must match the video ID');
  if (!['Dhamma talk','Q&A'].includes(talk.type)) fail('unsupported talk type');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(talk.date) || !Number.isFinite(Date.parse(talk.date)) || new Date(talk.date).toISOString().slice(0,10) !== talk.date) fail('invalid date');
  for (const key of ['title','originalTitle','brief','summaryMarkdown']) if (typeof talk[key] !== 'string' || !talk[key].trim()) fail(`${key} is required`);
  if (!Array.isArray(talk.topics) || !talk.topics.length || !talk.topics.every(topic => typeof topic === 'string' && topic.trim())) fail('topics must be a nonempty list');
  if (!Number.isInteger(talk.durationSeconds) || talk.durationSeconds < 1) fail('duration must be positive whole seconds');
  if (talk.thumbnailUrl) {
    if (talk.thumbnailUrl.startsWith('/')) {
      if (talk.thumbnailUrl !== `/assets/images/talks/${talk.youtubeId}.jpg`) fail('local thumbnail must match the video');
    } else {
      let thumb; try { thumb = new URL(talk.thumbnailUrl); } catch { fail('invalid thumbnail URL'); }
      if (thumb.protocol !== 'https:' || thumb.hostname !== 'i.ytimg.com' || !thumb.pathname.startsWith(`/vi/${talk.youtubeId}/`)) fail('thumbnail must match the video');
    }
  }
  return {...talk, url:url.href};
}

export function prepareTalks(records) {
  const ids = new Set(), videos = new Set();
  return records.map(record => validateTalk(record)).map(talk => {
    if (ids.has(talk.id) || videos.has(talk.youtubeId)) throw new Error(`Duplicate entry or video: ${talk.id}`);
    ids.add(talk.id); videos.add(talk.youtubeId); return talk;
  }).filter(talk => talk.published).sort((a,b) => b.date.localeCompare(a.date)).map(talk => ({...talk,
    dateLabel:new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(talk.date)),
    readingUrl:`/talks/${talk.id}/`, summaryHtml:markdown(talk.summaryMarkdown)
  }));
}
