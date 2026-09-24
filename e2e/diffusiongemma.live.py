# /// script
# dependencies = ["typesafe-sdk==0.7.1"]
# ///
# First run the JS image E2E to create the fixture, then:
# uv run e2e/diffusiongemma.live.py (against npm run dev on port 3000)
import base64, os
from pathlib import Path
from typesafe_sdk import TypeSafeClient,Choice,Noul,Score
image='data:image/png;base64,'+base64.b64encode(Path('captures/diffusiongemma-red.png').read_bytes()).decode()
with TypeSafeClient(api_key=os.environ.get('CLASSIFIER_API_KEY', 'unused'),base_url=os.environ.get('CLASSIFIER_BASE_URL', 'http://127.0.0.1:3000')) as client:
 r=client.system_one(model='jev/diffusiongemma',state='Look at the image.',timeout=60,extra_body={'images':[image]},questions={
  'color':Choice(instructions='What color is the image?',criteria={'red':None,'blue':None}),
  'red':Noul(instructions='Is the image red?'),
  'intensity':Score(instructions='How red is the image?',criteria=['Not red','Some red','Entirely red'])})
 print('Python TypeSafe SDK image E2E passed')
 Path('captures/diffusiongemma-python.json').write_text(r.model_dump_json(indent=2))
 assert r.choices['color'].choice=='red'
 assert r.nouls['red'].noul > 0.9
 assert r.scores['intensity'].score > 1.8
