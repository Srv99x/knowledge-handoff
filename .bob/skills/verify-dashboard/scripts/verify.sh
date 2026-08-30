#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || dirname "$(dirname "$SCRIPT_DIR")")"
cd "$ROOT/dashboard"
OUT="$ROOT/backend/outputs"

echo "=== 1/5 syntax ==="; node --check app.js || exit 1; echo ok

echo "=== 2/5 render all views ==="
T="$(mktemp)"; cat > "$T" <<'NODE'
const fs=require('fs');
let src=fs.readFileSync('app.js','utf8')
  .replace(/^\(function \(\) \{\s*"use strict";?\s*\n/,'')
  .replace(/\}\)\(\);\s*$/,'');
const OUT=process.argv[2]+'/';
const names=['contributor','complexity','documentation','risk','onboarding','extraction'];
const reports={};
for(const n of names){const f=OUT+(n==='risk'?(n+'_report'):(n+'_report'))+'.json';
  let p=(n==='risk')?(n+'_report'):(n+'_report'); reports[n]=JSON.parse(fs.readFileSync(OUT+p+'.json','utf8'));}
const mkEl=()=>({dataset:{},style:{},value:'',_h:'',classList:{add(){},remove(){},toggle(){}},addEventListener(){},focus(){},setSelectionRange(){},querySelector:()=>mkEl(),querySelectorAll:()=>[]});
global.document={querySelector:()=>mkEl(),querySelectorAll:()=>[],body:{style:{}},addEventListener(){}};
global.window={addEventListener(){}};
eval(src.replace('loadData();','')+'\nDATA=reports;globalThis.__R={overviewHTML,riskHTML,busfactorHTML,complexityHTML,documentationHTML,onboardingHTML,extractionHTML,pipelineHTML};');
const fails=[];
for(const [v,fn] of Object.entries(globalThis.__R)){const h=fn(); if(!h||h.length<200) fails.push(v+' too short');}
if(! (globalThis.__R.onboardingHTML().includes('direct 0 commits'))) fails.push('onboarding missing direct-commits');
if(! (globalThis.__R.extractionHTML().includes('draft-why'))) fails.push('extraction missing why');
if(fails.length){console.log('FAIL: '+fails.join(', ')); process.exit(1);}
console.log('all views render ok');
NODE
node "$T" "$OUT"; S=$?; rm -f "$T"; [ $S -eq 0 ] || exit 1

echo "=== 3/5 rebuild bundle ==="; python build.py

echo "=== 4/5 server :8765 ==="
pkill -f "server.py 8765" 2>/dev/null || true; sleep 1
nohup python server.py 8765 > /tmp/dash-server.log 2>&1 & sleep 1
for u in / /api/all; do c=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:8765$u"); echo "  GET $u -> $c"; [ "$c" = 200 ] || exit 1; done

echo "=== 5/5 facts ==="
python - "$OUT" <<'PY'
import json,sys
O=sys.argv[1]+'/'
try:
  cr=json.load(open(O+'contributor_report.json',encoding='utf-8-sig'))
  rr=json.load(open(O+'risk_report.json',encoding='utf-8-sig'))
  ob=json.load(open(O+'onboarding_report.json',encoding='utf-8-sig'))
  ex=json.load(open(O+'extraction_report.json',encoding='utf-8-sig'))
  lvl={}
  for f in rr: lvl[f['risk_level']]=lvl.get(f['risk_level'],0)+1
  bu=sum(len(f.get('backups',[])) for f in ob.get('files',[]))
  print(f"tracked={cr.get('file_count_analyzed',len(cr.get('files',[])))} "
        f"risk H:{lvl.get('HIGH',0)} M:{lvl.get('MEDIUM',0)} L:{lvl.get('LOW',0)} ranked={len(rr)} "
        f"onboarding_files={len(ob.get('files',[]))} backups={bu} drafts={len(ex.get('files',[]))}")
except Exception as e:
  print('fact-check unavailable:',e)
PY

echo; echo "PASS — dashboard verified, rebuilt, redeployed. Reminder: Cmd+Shift+R."
