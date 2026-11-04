import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from check_production_compose import validate


def config():
    return {'services':{
        'frontend':{'healthcheck':{'test':['check']}},
        'backend':{'volumes':[{'target':'/backups','source':'same','read_only':True}],
                   'depends_on':{'backup':{'condition':'service_healthy'}},'environment':{'AUTH_PROXY_SECRET':'test-control'}},
        'backup':{'volumes':[{'target':'/backups','source':'same'}],'environment':{'AUTH_PROXY_SECRET':'test-control'}}}}


def test_current_layout_passes_without_exposing_secret():
    assert validate(config())==[]


def test_local_dev_override_cannot_reactivate_vite_source_mounts_or_public_port():
    value=config();value['services']['frontend'].update(command=['pnpm','dev'],volumes=[{'source':'./src','target':'/app/frontend/src'}],ports=[{'published':'5173'}])
    assert len(validate(value))==3


def test_mismatched_volume_and_control_secret_fail_without_showing_values():
    value=config();value['services']['backup']['environment']['AUTH_PROXY_SECRET']='do-not-print'
    value['services']['backup']['volumes'][0]['source']='different'
    errors=validate(value)
    assert len(errors)==2
    assert 'do-not-print' not in str(errors)
