# All text written for this eval. Gold labels hand-assigned.
from flagship_data import TAGS50, ARTICLE, GOLD

GENRES = ["comedy","drama","horror","science fiction","fantasy","documentary","romance","thriller",
"animation","war","western","musical","crime","biography","sports","family","mystery","noir","satire","adventure"]

TICKET = ["billing","refund","login problem","bug","feature request","documentation","performance",
"security","integration","pricing","cancellation","data export","mobile","accessibility","onboarding"]

SKILLS = ["python","javascript","typescript","rust","go","java","sql","react","vue","node","django",
"kubernetes","docker","aws","gcp","terraform","ci/cd","machine learning","data engineering","etl",
"postgres","redis","kafka","graphql","rest api","testing","security","leadership","mentoring","agile"]

ASPECTS = ["battery life","screen quality","build quality","price","customer service","shipping",
"software","noise","comfort","durability","design","accessories"]

SUBSYS = ["authentication","database","caching","networking","ui rendering","file upload","search",
"notifications","billing","permissions","logging","migration","api","mobile app","email","scheduler","import","export"]

TOPICS = ["politics","economy","technology","health","climate","education","sports","entertainment",
"science","business","law","immigration","housing","transport","energy","agriculture","labor",
"international","military","local government","media","religion","crime","infrastructure","elections"]

CASES = [
 ("tech article / 50 tags", TAGS50, ARTICLE, GOLD),

 ("film synopsis / genres", GENRES,
  "A washed-up detective in a rain-soaked city takes one last case: a missing heiress, a nightclub "
  "owner who lies for sport, and a partner who may be on the take. Shot in black and white, the film "
  "plays its grim double-crosses for uneasy laughs, and ends with a shrug rather than a shootout.",
  ["crime","mystery","noir","drama","comedy"]),

 ("support ticket / areas", TICKET,
  "I upgraded to the Pro plan on Tuesday and was charged twice. On top of that the dashboard now takes "
  "close to a minute to load on my phone, and the invoice download button returns a 500. I would like "
  "one of the charges reversed.",
  ["billing","refund","bug","performance","mobile"]),

 ("job posting / skills", SKILLS,
  "We are hiring a senior backend engineer to own our data platform. You will write Python and SQL "
  "daily, maintain Airflow pipelines feeding a Postgres warehouse, and tune Kafka consumers under load. "
  "Experience with Terraform and AWS is expected, and you will mentor two junior engineers.",
  ["python","sql","postgres","kafka","terraform","aws","data engineering","etl","mentoring"]),

 ("product review / aspects", ASPECTS,
  "Three months in. The battery still gets me through a full day, and the aluminium body has survived "
  "two drops without a mark. But the fans are audible in a quiet room, and support took nine days to "
  "answer a simple question. For the money I expected better on both counts.",
  ["battery life","build quality","durability","noise","customer service","price"]),

 ("bug report / subsystems", SUBSYS,
  "After the 4.2 migration, users with SSO accounts cannot log in — the session token is issued but the "
  "permission check rejects it. Attaching a file over 10MB also now fails silently, and nothing shows up "
  "in the logs for either case.",
  ["authentication","permissions","migration","file upload","logging"]),

 ("news story / topics", TOPICS,
  "The council approved a rezoning plan that clears the way for 4,000 new apartments near the rail "
  "corridor, over objections from residents worried about school capacity. Construction unions backed the "
  "measure, citing three years of steady work. The vote fell along party lines ahead of the spring election.",
  ["housing","local government","transport","education","labor","politics","elections"]),
]
