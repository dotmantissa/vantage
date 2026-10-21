import json
import pytest

PATH = 'contracts/vantage_charter_v2.py'

def test_default_manifest_groups_related_github_hosts(direct_deploy):
    c = direct_deploy(PATH)
    body = json.loads(c.get_charter())
    sources = {s['id']: s for s in body['sources']}
    assert sources['github-api']['publisher_group'] == sources['github-web']['publisher_group']
    assert body['fee_bps'] == 200
    assert len(body['templates']) == 2

def test_versions_are_immutable_and_owner_controlled(direct_deploy, direct_vm, direct_bob):
    c = direct_deploy(PATH)
    body = json.loads(c.get_charter())
    body['version'] = 'v2.2'
    c.publish_charter('v2.2', json.dumps(body))
    assert json.loads(c.get_charter())['version'] == 'v2.1'
    c.set_active_version('v2.2')
    with pytest.raises(Exception, match='existing version'):
        c.publish_charter('v2.2', json.dumps(body))
    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match='Only owner'):
        c.publish_charter('v2.3', json.dumps(body))

def test_invalid_policy_cannot_be_published(direct_deploy):
    c = direct_deploy(PATH)
    body = json.loads(c.get_charter()); body['version'] = 'v2.2'; body['sources'][1]['id'] = 'github-api'
    with pytest.raises(Exception, match='manifest identity'):
        c.publish_charter('v2.2', json.dumps(body))
    body['sources'][1]['id'] = 'github-web'; body['fee_bps'] = 1001
    with pytest.raises(Exception, match='fee split'):
        c.publish_charter('v2.2', json.dumps(body))

def test_malformed_template_cannot_be_published(direct_deploy):
    c=direct_deploy(PATH);body=json.loads(c.get_charter());body['version']='v2.2'
    body['templates']=[{'id':'bad','name':'Malformed','criteria':['tiny']}]
    with pytest.raises(Exception,match='template criteria'):
        c.publish_charter('v2.2',json.dumps(body))
