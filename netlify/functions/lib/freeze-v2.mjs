import { store, normName } from "./war-v2.mjs";

function projectionKey(data) {
  return `projection_${data.league.id}_${data.week}`;
}

function reasoningKey(data) {
  return `reasoning_snapshot_${data.league.id}_${data.week}`;
}

export function mergeProjectionSnapshot(data, prior=null, now=Date.now()) {
  const players={...(prior?.players||{})};
  for(const p of data.players||[]){
    // Once kickoff passes, never overwrite the last pre-kickoff belief.
    if(p.locked) continue;
    players[p.pid]={
      pid:p.pid,
      name:p.name,
      slot:p.slot,
      team:p.team,
      rawBase:p.rawBase,
      base:p.base,
      projection:p.projection,
      signals:p.signals||{},
      fallback:!!p.fallback,
      injury:p.injury||null,
      confidence:p.confidence||null,
      savedAt:now,
      kickoffAt:p.kickoffAt||null,
    };
  }
  return {
    leagueId:data.league.id,
    season:data.league.season,
    week:data.week,
    updatedAt:now,
    players,
  };
}

export function mergeReasoningSnapshot(data, analysis, prior=null, now=Date.now()) {
  const calls={...(prior?.calls||{})};
  const byName={};
  for(const p of data.players||[]) byName[normName(p.name)]=p;

  for(const call of analysis?.calls||[]){
    if(!call.start || !call.sit) continue;
    const start=byName[normName(call.start)];
    const sit=byName[normName(call.sit)];
    if(!start || !sit) continue;

    // A reasoning judgment is trainable only while both choices were still
    // actionable. Later snapshots cannot rewrite a Thursday decision after
    // either player's game has started.
    if(start.locked || sit.locked) continue;

    // Same two-player decision gets one record. If the engine flips before
    // kickoff, the latest pregame belief replaces the earlier one instead of
    // letting Tuesday count both sides of the same decision.
    const pair=[start.pid,sit.pid].sort().join("__");
    const key=`${pair}__${call.slot||""}`;
    calls[key]={
      ...call,
      startPid:start.pid,
      sitPid:sit.pid,
      frozenAt:now,
    };
  }

  return {
    leagueId:data.league.id,
    season:data.league.season,
    week:data.week,
    updatedAt:now,
    calls,
  };
}

export async function freezePregame(data, analysis=null, now=Date.now()) {
  if(!data?.league?.id || !data?.week) throw new Error("cannot freeze incomplete lineup data");
  const s=store();

  const pKey=projectionKey(data);
  const priorProjection=await s.get(pKey,{type:"json"}).catch(()=>null);
  const projection=mergeProjectionSnapshot(data,priorProjection,now);
  await s.setJSON(pKey,projection);

  let reasoning=null;
  if(analysis){
    const rKey=reasoningKey(data);
    const priorReasoning=await s.get(rKey,{type:"json"}).catch(()=>null);
    reasoning=mergeReasoningSnapshot(data,analysis,priorReasoning,now);
    await s.setJSON(rKey,reasoning);
  }

  return {
    projectionPlayers:Object.keys(projection.players||{}).length,
    reasoningCalls:Object.keys(reasoning?.calls||{}).length,
  };
}

export { projectionKey, reasoningKey };
