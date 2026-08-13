TAGS50 = ["machine learning","databases","distributed systems","security","privacy","startups",
"venture capital","open source","developer tools","cloud infrastructure","serverless","kubernetes",
"programming languages","rust","python","javascript","web development","frontend","backend","devops",
"observability","performance optimization","caching","networking","cryptography","blockchain",
"hardware","semiconductors","climate","biotech","healthcare","education","gaming","social media",
"regulation","antitrust","labor","remote work","hiring","product management","design","typography",
"accessibility","mobile","ios","android","testing","compilers","operating systems","robotics"]
ARTICLE = """After eighteen months running our own Postgres cluster on rented metal, we moved the
whole thing to a managed serverless platform and cut the on-call rota in half. The migration was not
free. We rewrote the connection pooling layer in Rust because the Python service could not hold
enough idle connections without ballooning memory, and we spent three weeks building out tracing
before we trusted a single query path. What surprised us was the caching story: once we put a
read-through cache in front of the hottest ten queries, p99 latency dropped from 400ms to 38ms and
our compute bill fell by roughly 60 percent. The engineers who had been carrying the pager every
third week got their evenings back, which mattered more for retention than any of the numbers.
We open sourced the pooling library last month."""
GOLD = ["databases","distributed systems","cloud infrastructure","serverless","rust","python",
        "backend","devops","observability","performance optimization","caching","open source"]
