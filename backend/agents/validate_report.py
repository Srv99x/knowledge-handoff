import json
from pathlib import Path

_REPORT = Path(__file__).resolve().parent.parent / "outputs" / "documentation_report.json"
with open(_REPORT) as f:
    r = json.load(f)

required_file_fields = {'file', 'documentation_score', 'metrics', 'reason'}
required_metrics = {'comment_count', 'docstring_count', 'has_file_description', 'has_external_documentation'}
errors = []

for entry in r['files']:
    fname = entry.get('file', '?')
    missing = required_file_fields - set(entry.keys())
    if missing:
        errors.append(fname + ' missing fields: ' + str(missing))
    m = entry.get('metrics', {})
    missing_m = required_metrics - set(m.keys())
    if missing_m:
        errors.append(fname + ' missing metric fields: ' + str(missing_m))
    score = entry['documentation_score']
    if not isinstance(score, int) or not (0 <= score <= 100):
        errors.append(fname + ' bad score: ' + str(score))
    if not isinstance(entry['reason'], str) or len(entry['reason']) < 5:
        errors.append(fname + ' bad reason')

if errors:
    for e in errors:
        print('ERROR:', e)
else:
    scores = [x['documentation_score'] for x in r['files']]
    print('All', len(r['files']), 'entries pass validation.')
    print('Score range:', min(scores), '-', max(scores))
    print('Avg score:', round(sum(scores) / len(scores), 1))
    print('agent:', r['agent'])
    print('file_count_analyzed:', r['file_count_analyzed'])
