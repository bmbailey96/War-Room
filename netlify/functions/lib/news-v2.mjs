// Public RSS only. No credentials, model inference, or paid search service.
export const NEWS_FEEDS = [
  {name:'CBS Sports',url:'https://www.cbssports.com/rss/headlines/nfl/'},
  {name:'Yahoo Sports',url:'https://sports.yahoo.com/nfl/rss.xml'},
  {name:'RotoWire',url:'https://www.rotowire.com/rss/news.php?sport=NFL'},
];
const CACHE_KEY='public_news_v1',TTL=15*60*1000,RETRY=2*60*1000,MAX_AGE=72*60*60*1000;
export function plainText(value=''){
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ')
    .replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const c=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return c>0&&c<=0x10ffff?String.fromCodePoint(c):''})
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/g,(_,n)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '})[n])
    .replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
}
export function safeNewsUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}}
export function parseNewsRss(xml,source,now=Date.now()){
  if(typeof xml!=='string'||xml.length>1500000||!/<rss\b/i.test(xml))throw new Error('Invalid RSS response');
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0,100).flatMap(([,item])=>{
    const get=tag=>plainText(item.match(new RegExp('<'+tag+'\\b[^>]*>([\\s\\S]*?)<\\/'+tag+'>','i'))?.[1]||'');
    const title=get('title'),url=safeNewsUrl(get('link')),publishedAt=Date.parse(get('pubDate'));
    if(!title||!url||!Number.isFinite(publishedAt)||publishedAt>now+15*60000||publishedAt<now-MAX_AGE)return [];
    return [{title:title.slice(0,300),url,publishedAt,source,description:get('description').slice(0,1200)}];
  });
}
export async function readNewsFeeds(cache,{fetcher=fetch,now=Date.now()}={}){
  const previous=await cache.get(CACHE_KEY,{type:'json'}).catch(()=>null);
  const ttl=previous?.sources?.every(s=>s.ok)?TTL:RETRY;
  if(previous&&now-previous.checkedAt>=0&&now-previous.checkedAt<ttl)return previous;
  const sources=await Promise.all(NEWS_FEEDS.map(async feed=>{
    const old=previous?.sources?.find(s=>s.name===feed.name);
    try{
      const response=await fetcher(feed.url,{signal:AbortSignal.timeout(7000),headers:{accept:'application/rss+xml, application/xml, text/xml','user-agent':'OchoWarRoom/2.0'}});
      if(!response.ok)throw new Error('Feed unavailable');
      const items=parseNewsRss(await response.text(),feed.name,now);
      return {name:feed.name,ok:true,lastSuccessAt:now,items};
    }catch{
      return {name:feed.name,ok:false,lastSuccessAt:old?.lastSuccessAt||null,items:(old?.items||[]).filter(x=>x.publishedAt>=now-MAX_AGE)};
    }
  }));
  const result={checkedAt:now,sources};
  await cache.setJSON(CACHE_KEY,result).catch(()=>{});
  return result;
}
const normalized=s=>plainText(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
export function matchRosterNews(feedData,players=[],now=Date.now()){
  const names=[...new Set(players.map(p=>p.name).filter(Boolean))].map(name=>({name,key:normalized(name)})).filter(p=>p.key.split(' ').length>=2);
  const unique=new Map();
  for(const source of feedData.sources||[]){
    for(const item of source.items||[]){
      if(item.publishedAt<now-MAX_AGE||item.publishedAt>now+15*60000||!safeNewsUrl(item.url))continue;
      const text=' '+normalized(item.title+' '+item.description)+' ';
      const matched=names.filter(p=>text.includes(' '+p.key+' ')).map(p=>p.name);
      if(!matched.length)continue;
      const row={title:item.title,url:item.url,source:item.source,publishedAt:item.publishedAt,players:matched,stale:!source.ok};
      const key=normalized(item.title),old=unique.get(key);
      if(!old||(old.stale&&!row.stale))unique.set(key,row);
    }
  }
  const sources=(feedData.sources||[]).map(({name,ok,lastSuccessAt})=>({name,ok,lastSuccessAt}));
  return {checkedAt:feedData.checkedAt,sources,available:sources.some(s=>s.ok),items:[...unique.values()].sort((a,b)=>Number(a.stale)-Number(b.stale)||b.publishedAt-a.publishedAt).slice(0,12)};
}
