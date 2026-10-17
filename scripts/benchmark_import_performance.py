"""Isolated real AUS workbook benchmark. Never connects to configured database."""
import sys,os,json,time,cProfile,pstats,re,argparse
from pathlib import Path
from collections import Counter
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),os.environ.get('IMPORT_BENCHMARK_BACKEND',str(ROOT/'backend'))]
from scripts.test_backend import environment
os.environ.update(environment(False))
if os.environ.get('IMPORT_BENCHMARK_BACKEND'):
 sys.path.insert(0,os.environ['IMPORT_BENCHMARK_BACKEND'])
from flask import Flask
from sqlalchemy import event as sa_event
from datetime import datetime
import pandas as pd
import app as routes
import excel_import as imports
from models import db,Competition,Event,EventCompetition,ImportSession,ImportSessionVersion,Athlete,Hotel,RoomType,RoomBooking,RoomBookingOccupant
from competitions import COMPETITIONS
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--label',default='current');parser.add_argument('--repetitions',type=int,default=3);args=parser.parse_args()
OUT=ROOT/'work/performance';OUT.mkdir(parents=True,exist_ok=True);label=args.label;results=[]
fixture=json.loads((ROOT/'backend/tests/fixtures/real_entries/AUS.json').read_text())
for key in ('entries','rooms'):
 pd.DataFrame(fixture[key]).to_excel(OUT/f'{key}.xlsx',index=False)
app=Flask(__name__);app.config.update(routes.app.config);app.config.update(SQLALCHEMY_DATABASE_URI='sqlite://',TESTING=True)
db.init_app(app);app.before_request(routes.authenticate_api_request)
for rule in routes.app.url_map.iter_rules():
 if rule.rule.startswith('/api/'):
  app.add_url_rule(rule.rule,endpoint=rule.endpoint,view_func=routes.app.view_functions[rule.endpoint],methods=rule.methods)
with app.app_context():
 for repetition in range(args.repetitions):
  db.create_all();e=Event(name='Performance AUS');db.session.add(e)
  for definition in COMPETITIONS:
   c=Competition(**definition._asdict());db.session.add(EventCompetition(event=e,competition=c,import_code=definition.import_code,fis_codex=definition.code,official_name=definition.name))
  db.session.commit();eid=e.id
  def measure(name,fn):
   queries=[];flushes=[];commits=[];prof=cProfile.Profile();sql_ms=Counter();sql_counts=Counter()
   def query(conn,cursor,statement,parameters,context,executemany):
    queries.append(statement);context._import_benchmark_start=time.perf_counter()
   def executed(conn,cursor,statement,parameters,context,executemany):
    elapsed=(time.perf_counter()-context._import_benchmark_start)*1000
    sql_ms['all']+=elapsed;sql_counts['all']+=1
    for category,needle in (('memberships','athlete_competition'),('bookings','room_booking'),('audit_history','import_session_event'),('audit_history','audit_event')):
     if needle in statement.lower():
      sql_ms[category]+=elapsed;sql_counts[category]+=1
   def flush(session,ctx,instances):flushes.append(1)
   def commit(session):commits.append(1)
   sa_event.listen(db.engine,'before_cursor_execute',query);sa_event.listen(db.engine,'after_cursor_execute',executed);sa_event.listen(db.session,'before_flush',flush);sa_event.listen(db.session,'after_commit',commit)
   start=time.perf_counter();prof.enable();value=fn();prof.disable();elapsed=time.perf_counter()-start
   sa_event.remove(db.engine,'before_cursor_execute',query);sa_event.remove(db.engine,'after_cursor_execute',executed);sa_event.remove(db.session,'before_flush',flush);sa_event.remove(db.session,'after_commit',commit)
   stats=pstats.Stats(prof);phases={}
   for (path,line,func),(cc,nc,tt,ct,callers) in stats.stats.items():
    if func in {'load_first_sheet','parse_entries_list','parse_room_list','_build_existing_athlete_maps','_find_existing_athlete','apply_preview_requirements','apply_preview_rates','apply_single_room_quota_exemptions','preserved_single_room_approvals','build_quota_warnings','build_disposition_analysis','person_accommodation_coverage','_assignment_context','audit_status','flush','commit','_serialize_person_preview','_current_session_payload','recalculate_fis_import_preview','_apply_person_record','resolve_saved_quota_memberships'}:
     key=f'{Path(path).name}:{func}';phases[key]={'calls':nc,'ms':round(ct*1000,3)}
   payload=value.get_json() if hasattr(value,'get_json') else value
   if isinstance(payload,dict):
    # Volatile tokens/timestamps are intentionally excluded from business equality.
    projected={key:payload[key] for key in ('people','rooms','quotaChecks','athleteQuotaChecks','errors','warnings','dispositionAnalysis','summary') if key in payload}
    if name in ('session_detail','post_confirm_detail'):
     projected={key:payload.get('preview',{}).get(key) for key in ('people','rooms','quotaChecks','athleteQuotaChecks','errors','warnings','dispositionAnalysis')}
    (OUT/f'{label}-{name}-{repetition}-payload.json').write_text(json.dumps(projected,sort_keys=True,default=str,indent=2))
   row={'repetition':repetition,'phase':name,'ms':round(elapsed*1000,3),'queries':len(queries),'selects':sum(q.lstrip().upper().startswith('SELECT') for q in queries),'flushes':len(flushes),'commits':len(commits),'query_shapes':Counter(re.sub(r'\s+',' ',q)[:180] for q in queries).most_common(10),'functions':phases,'sql_ms':dict(sql_ms),'sql_counts':dict(sql_counts)}
   results.append(row);prof.dump_stats(str(OUT/f'{label}-{name}-{repetition}.prof'))
   print(name,row['ms'],row['queries'],flush=True)
   return value
  initial=imports.create_fis_import_preview(str(OUT/'entries.xlsx'),str(OUT/'rooms.xlsx'),e);measure('initial_confirmation',lambda:imports.confirm_fis_import(initial['previewToken']))
  persons=Athlete.query.order_by(Athlete.id).all()
  persons[0].accommodation_rate_category='SPECIAL';persons[0].accommodation_rate_source='MANUAL'
  h=Hotel(name='Fixture hotel');rt=RoomType(name='DZ',max_persons=2);db.session.add_all([h,rt]);db.session.flush()
  for p in [p for p in persons if p.accommodation_requirement!='NO_ROOM'][:4]:
   b=RoomBooking(hotel=h,room_type=rt,check_in_date=p.arrival_date,check_out_date=p.departure_date,counts_as_single=False);db.session.add(b);db.session.flush();db.session.add(RoomBookingOccupant(athlete=p,room_booking=b))
  db.session.commit();db.session.remove()
  e=db.session.get(Event,eid)
  result=measure('preview',lambda:imports.create_fis_import_preview(str(OUT/'entries.xlsx'),str(OUT/'rooms.xlsx'),e))
  s=ImportSession(nation='AUS',status='APPROVED',approved_at=datetime.utcnow());db.session.add(s);db.session.flush()
  v=ImportSessionVersion(session_id=s.id,version=1,preview_json=json.dumps(result),preview_token=result['previewToken'],uploaded_by='benchmark');db.session.add(v);db.session.flush();s.current_version=v;db.session.commit();sid=s.id;db.session.remove()
  client=app.test_client()
  response=measure('session_detail',lambda:client.get(f'/api/import/sessions/{sid}'));assert response.status_code==200,response.get_json();db.session.remove()
  response=measure('session_list',lambda:client.get('/api/import/sessions'));assert response.status_code==200;db.session.remove()
  response=measure('confirmation',lambda:client.post(f'/api/import/sessions/{sid}/import'));assert response.status_code==200,response.get_json();db.session.remove()
  response=measure('post_confirm_detail',lambda:client.get(f'/api/import/sessions/{sid}'));assert response.status_code==200;db.session.remove()
  assert Athlete.query.count()==58
  snapshot=[{key:getattr(p,key) for key in ('id','fis_code','competitor_id','function','accommodation_requirement','accommodation_requirement_source','accommodation_rate_category','accommodation_rate_source','single_room_status','single_room_entitlement','import_change_types_json','import_change_details_json')} | {'competitions':[c.id for c in p.competitions]} for p in Athlete.query.order_by(Athlete.id).all()]
  (OUT/f'{label}-persisted-{repetition}.json').write_text(json.dumps(snapshot,sort_keys=True,indent=2))
  db.session.remove();db.drop_all();imports.PREVIEW_STORE.clear()
(OUT/f'{label}.json').write_text(json.dumps(results,indent=2))
