# Deploy Jeff Fast on Salad

`salad.example.json` describes one replica with 4 CPU cores, 16,384 MB RAM and
30 GiB disk. Replace the image and GPU placeholders before submitting it. This
is a migration recipe, not a verified Salad deployment or a quoted hourly price.

## Preflight

Use an existing organization and project **name**, supplied by the authenticated
portal or account owner. The public API has scoped reads but no organization or
project enumeration operation. Every request below uses the `Salad-Api-Key`
header and the base URL `https://api.salad.com/api/public`.
[Scope and preflight](https://docs.salad.com/agents/container-engine/discover-scope-and-preflight).

| Method and path | Check before creating anything |
| --- | --- |
| `GET /organizations/{org}/quotas` | `container_replicas_quota - container_replicas_used` allows one more replica. |
| `GET /organizations/{org}/projects/{project}/containers` | Confirm access and that `jeff-fast` does not already exist. Follow any pagination; reconcile an existing group instead of overwriting it. |
| `GET /organizations/{org}/gpu-classes` | Select a returned `id`; inspect its `name`, resource limits and `prices` for the selected priority. |
| `POST /organizations/{org}/availability/sce-gpu-availability` | Read capacity using the exact resource request below. This does not allocate a GPU. |

Availability body (substitute the same live UUID as the template):

```json
{"gpu_classes":["<gpu-class-uuid-from-live-api>"],"cpu":4,"memory":16384,"storage_amount":32212254720}
```

Choose an RTX class with **at least 24 GB VRAM** and a host driver compatible with
the image's PyTorch CUDA 13 runtime. The class API does not expose VRAM; verify
the actual model's memory and driver compatibility separately. Do not invent a
UUID or treat a GPU model name as one. Confirm that the class allows this CPU,
RAM and disk request. The template uses `container.priority: "medium"`; inspect
that tier's price and `available_gpu_medium`. Missing availability fields mean
unknown, and reported availability is an estimate, not a reservation. Compare
the complete resource quote rather than treating a GPU class price as total
service cost. [GPU classes](https://docs.salad.com/reference/saladcloud-api/organizations/list-gpu-classes).

Use a registry image pinned as `repository@sha256:<64 hex digits>`. The template
assumes Salad can pull it without registry credentials; a private image needs
the documented `container.registry_authentication` configuration. Retain the
image's `/app/entrypoint.sh` entrypoint. Confirm enough disk for the expanded
image, approximately 2 GB checkpoint, and compiler caches. The first download
and compilation can take several minutes; replacement hosts can repeat them.

## Create, inspect, start

Inject `SALAD_API_KEY` and a separate, random `JEFF_API_KEY` (at least 24
characters) through your secret manager into the deployment process's
environment. Also set `SALAD_ORGANIZATION`, `SALAD_PROJECT`, `JEFF_IMAGE` and
`SALAD_GPU_CLASS`. Do not commit a rendered payload, put secrets in command-line
arguments, or log returned environment maps. Salad's create schema takes
application secrets as `container.environment_variables` string values; this
template does not claim a secret-reference feature.

After preflight, run this from `gpu/jeff` to create the group **stopped**. It
keeps the substituted payload in memory and prints only non-secret status.

```python
import json, os, re, uuid
from urllib.request import Request, urlopen

env = os.environ
org, project = env["SALAD_ORGANIZATION"], env["SALAD_PROJECT"]
for name in (org, project):
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,61}[a-z0-9]", name):
        raise ValueError("Invalid organization or project name")
image, key = env["JEFF_IMAGE"], env["JEFF_API_KEY"]
if not re.fullmatch(r"[^\s<>]+@sha256:[0-9a-f]{64}", image) or len(key) < 24:
    raise ValueError("Require an immutable image digest and a strong Jeff key")
gpu = str(uuid.UUID(env["SALAD_GPU_CLASS"]))
with open("salad.example.json") as source:
    body = json.load(source)
body["container"]["image"] = image
body["container"]["resources"]["gpu_classes"] = [gpu]
body["container"]["environment_variables"]["JEFF_API_KEY"] = key
base = f"https://api.salad.com/api/public/organizations/{org}/projects/{project}/containers"
headers = {"Salad-Api-Key": env["SALAD_API_KEY"], "Content-Type": "application/json"}
request = Request(base, data=json.dumps(body).encode(), headers=headers, method="POST")
with urlopen(request, timeout=60) as response:
    result = json.load(response)
    print({"http_status": response.status, "name": result["name"], "version": result.get("version")})
```

Expect `201 Created`. If the request times out, read the exact group before
retrying: creation may have succeeded. Read `GET {base}/jeff-fast` and verify
the pinned image, resources, one replica, networking, probes and stopped state.
Never print the whole response, which can contain environment values.
Then send `POST {base}/jeff-fast/start` with the same API header and **no body**;
expect `202 Accepted`. This starts the paid allocation. Monitor
`GET {base}/jeff-fast` and `GET {base}/jeff-fast/instances` until the desired
version has one running, ready instance. A successful create/start HTTP response
alone does not establish serving readiness.
[Deploy workflow](https://docs.salad.com/agents/container-engine/deploy-or-update-container-group),
[start operation](https://docs.salad.com/reference/saladcloud-api/container-groups/start-container-group).

## Gateway and probes

`JEFF_HOST=::` enables the IPv6 listener required by Salad's gateway. Container
HTTP uses port 8080; clients use HTTPS at the returned `networking.dns` hostname.
`networking.auth=false` permits the public probes; `/v1/decide` and `/metrics`
still require `Authorization: Bearer <JEFF_API_KEY>`. Do not distribute the
Salad control-plane API key to inference clients.
[Networking](https://docs.salad.com/container-engine/explanation/infrastructure-platform/networking).

The startup probe checks `/readyz` every 60 seconds, allowing approximately
20 minutes before 20 failures. It gates other probes and gateway traffic while
the model downloads and warms. Readiness then checks `/readyz` every 5 seconds;
the application returns 503 until ready. Liveness checks `/healthz` every 10
seconds. Health being 200 means the process responds, not that inference works.
The startup failure threshold of 20 is the schema maximum; extend the interval
within its documented limit if measured startup requires more time.
[Startup probes](https://docs.salad.com/container-engine/explanation/infrastructure-platform/startup-probes),
[API schema](https://docs.salad.com/api-specs/salad-cloud.yaml).

After readiness, check public health, verify an unauthenticated inference call
returns 401, then run the accompanying E2E and load scripts against the HTTPS
endpoint using the Jeff key. Record image digest, GPU class and actual GPU,
group version, ready time, throughput, latency, failures and the complete hourly
quote. Do not transfer results measured on another host to Salad.

## Current limitation

No Salad allocation or gateway E2E has been performed with this template.
Organization/project scope and a live GPU UUID remain unresolved. An attempted
organization-list URL received Cloudflare 403/1010; it is not a supported scope
discovery operation. Stop on that access block rather than retrying or bypassing
it; obtain the existing account scope through the authenticated portal or owner.
