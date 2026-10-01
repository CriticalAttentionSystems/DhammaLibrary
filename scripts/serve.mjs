import http from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.wasm':'application/wasm','.ftl':'text/plain; charset=utf-8','.ttf':'font/ttf','.otf':'font/otf','.json':'application/json','.yml':'text/yaml','.svg':'image/svg+xml','.ico':'image/x-icon','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.pdf':'application/pdf','.mp4':'video/mp4','.txt':'text/plain','.xml':'application/xml'};
export function byteRange(header,size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0,size-Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size-1,Number(match[2])) : size-1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? {start,end} : null;
}
let topicServicePromise;
async function topicService() {
  if (!topicServicePromise) {
    topicServicePromise = (async () => {
      const { createArchiveService, createFileStore } = await import('./topic-archive-service.mjs');
      const snapshot = JSON.parse(await readFile(new URL('../public/data/topic-archive.json',import.meta.url),'utf8'));
      const cacheFile = fileURLToPath(new URL('../work/topic-archive-cache.json',import.meta.url));
      return createArchiveService({snapshot,store:createFileStore(cacheFile)});
    })().catch(error => {topicServicePromise=undefined;throw error;});
  }
  return topicServicePromise;
}
export const server = http.createServer(async (request,response) => {
  try {
    if (new URL(request.url,'http://localhost').pathname === '/.netlify/functions/topic-archive') {
      const port = server.address().port;
      const host = request.headers.host;
      if (![`localhost:${port}`,`127.0.0.1:${port}`].includes(host)) {response.writeHead(403).end();return;}
      if ((request.headers['content-length'] && request.headers['content-length'] !== '0') || request.headers['transfer-encoding']) {response.writeHead(400).end('This endpoint takes no request body.');return;}
      const service = await topicService();
      const result = await service.handle(new Request(`http://${host}${request.url}`,{method:request.method,headers:request.headers}));
      response.writeHead(result.status,Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    if (!['GET','HEAD'].includes(request.method)) {response.writeHead(405,{'Allow':'GET, HEAD'}).end(); return;}
    const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    let file = path.resolve(root,'.'+pathname);
    if ((file !== root && !file.startsWith(root + path.sep)) || pathname.includes('\0')) {response.writeHead(403).end();return;}
    let info = await stat(file);
    if (info.isDirectory()) {file = path.join(file,'index.html');info=await stat(file);}
    const headers = {'Content-Type':types[path.extname(file)] || 'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
    let range;
    if (request.headers.range) {
      range = byteRange(request.headers.range,info.size);
      if (!range) {response.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return;}
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
    }
    headers['Content-Length'] = range ? range.end-range.start+1 : info.size;
    response.writeHead(range ? 206 : 200,headers);
    if (request.method === 'HEAD') response.end(); else createReadStream(file,range || {}).on('error',()=>response.destroy()).pipe(response);
  } catch { response.writeHead(404,{'Content-Type':'text/plain'}).end('Not found'); }
});
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(Number(process.env.PORT || 4173),'127.0.0.1',()=>console.log('Dhamma Library preview: http://127.0.0.1:' + server.address().port));
}
