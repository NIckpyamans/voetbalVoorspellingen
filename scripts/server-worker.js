#!/usr/bin/env node

import fs from "fs";
import path from "path";

const SOFA = "https://api.sofascore.com/api/v1";
const DATA_FILE = path.resolve(process.cwd(), "server_data.json");

/* ---------------- SAFE RUNTIME ---------------- */

process.on("unhandledRejection", err =>
  console.log("[worker] promise error:", err.message)
);

process.on("uncaughtException", err =>
  console.log("[worker] crash prevented:", err.message)
);

/* ---------------- SAFE FETCH ---------------- */

async function safeFetch(url) {

  try {

    const res = await fetch(url,{
      headers:{
        "Accept":"application/json",
        "User-Agent":"Mozilla/5.0 FootballPredictionBot"
      }
    });

    if(!res.ok){
      console.log("[worker] api blocked:",res.status);
      return null;
    }

    return await res.json();

  } catch(err){

    console.log("[worker] network error:",err.message);
    return null;

  }

}

/* ---------------- UTIL ---------------- */

function factorial(n){

  if(n<=1) return 1;

  let r=1;

  for(let i=2;i<=n;i++) r*=i;

  return r;

}

function poisson(lambda,k){

  return (Math.pow(lambda,k)*Math.exp(-lambda))/factorial(k);

}

function clamp(v,min,max){

  return Math.max(min,Math.min(max,v));

}

/* ---------------- TEAM MODEL ---------------- */

function getTeam(store,name){

  const key=name.toLowerCase();

  if(!store[key]){

    store[key]={
      name,
      elo:1500,
      attack:1.5,
      defense:1.5,
      form:""
    };

  }

  return store[key];

}

/* ---------------- PREDICTION MODEL ---------------- */

function scoreMatrix(hxg,axg){

  let best="1-1";
  let bestProb=0;

  let home=0;
  let draw=0;
  let away=0;

  for(let h=0;h<=6;h++){

    for(let a=0;a<=6;a++){

      const p=poisson(hxg,h)*poisson(axg,a);

      if(h>a) home+=p;
      else if(a>h) away+=p;
      else draw+=p;

      if(p>bestProb){

        bestProb=p;
        best=`${h}-${a}`;

      }

    }

  }

  return {best,home,draw,away,bestProb};

}

function predict(home,away){

  const homeAdv=1.18;
  const avgGoals=1.35;

  const hxg=avgGoals*(home.attack/away.defense)*homeAdv;
  const axg=avgGoals*(away.attack/home.defense);

  const m=scoreMatrix(hxg,axg);

  return{
    prediction:m.best,
    homeWin:m.home,
    draw:m.draw,
    awayWin:m.away,
    confidence:m.bestProb
  };

}

/* ---------------- LEARNING ---------------- */

function updateTeams(home,away,score){

  if(!score.includes("-")) return;

  const[h,a]=score.split("-").map(Number);

  const k=22;

  const expected=1/(1+Math.pow(10,(away.elo-home.elo)/400));

  const actual=h>a?1:h===a?0.5:0;

  home.elo+=k*(actual-expected);
  away.elo+=k*((1-actual)-(1-expected));

  const alpha=0.06;
  const avg=1.35;

  home.attack=clamp(home.attack*(1-alpha)+(h/avg)*alpha,0.6,3);
  home.defense=clamp(home.defense*(1-alpha)+(a/avg)*alpha,0.6,3);

  away.attack=clamp(away.attack*(1-alpha)+(a/avg)*alpha,0.6,3);
  away.defense=clamp(away.defense*(1-alpha)+(h/avg)*alpha,0.6,3);

}

/* ---------------- FALLBACK MATCHES ---------------- */

function syntheticMatches(){

  const teams=[
    "Ajax","PSV","Feyenoord","AZ",
    "Liverpool","Arsenal","Chelsea","Man City",
    "Real Madrid","Barcelona","Atletico",
    "Bayern","Dortmund","Leipzig"
  ];

  const list=[];

  for(let i=0;i<8;i++){

    const home=teams[Math.floor(Math.random()*teams.length)];
    let away=teams[Math.floor(Math.random()*teams.length)];

    if(home===away) away=teams[(i+1)%teams.length];

    list.push({
      id:`sim-${Date.now()}-${i}`,
      home,
      away
    });

  }

  return list;

}

/* ---------------- FETCH MATCHES ---------------- */

async function fetchMatches(){

  const date=new Date().toISOString().split("T")[0];

  const url=`${SOFA}/sport/football/scheduled-events/${date}`;

  const json=await safeFetch(url);

  if(!json || !json.events){

    console.log("[worker] fallback matches used");

    return syntheticMatches();

  }

  return json.events.map(e=>({

    id:e.id,
    home:e.homeTeam?.name || "Home",
    away:e.awayTeam?.name || "Away"

  }));

}

/* ---------------- MAIN ---------------- */

async function main(){

  console.log("[worker] start");

  const matches=await fetchMatches();

  let store={
    teams:{},
    memory:[],
    predictions:{},
    lastRun:null
  };

  if(fs.existsSync(DATA_FILE))
    store=JSON.parse(fs.readFileSync(DATA_FILE));

  const predictions=[];

  for(const m of matches){

    const home=getTeam(store.teams,m.home);
    const away=getTeam(store.teams,m.away);

    const p=predict(home,away);

    predictions.push({
      match:`${m.home} vs ${m.away}`,
      prediction:p.prediction,
      confidence:p.confidence
    });

  }

  const date=new Date().toISOString().split("T")[0];

  store.predictions[date]=predictions;
  store.lastRun=Date.now();

  fs.writeFileSync(DATA_FILE,JSON.stringify(store,null,2));

  console.log("[worker] predictions:",predictions.length);
  console.log("[worker] finished");

}

main();
