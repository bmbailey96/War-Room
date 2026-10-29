import { store } from './lib/war-v2.mjs';
import { readNewsFeeds } from './lib/news-v2.mjs';
export default async ()=>{
  const news=await readNewsFeeds(store());
  return Response.json({checkedAt:news.checkedAt,sources:news.sources.map(({name,ok})=>({name,ok}))});
};
export const config={schedule:'*/30 * * * *'};
