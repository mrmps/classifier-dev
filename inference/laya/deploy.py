"""Global trial: one warm fast GPU, bulk scales to zero; one GPU maximum per lane."""
from pathlib import Path
import modal

MODEL = "convaiinnovations/laya"
REVISION = "1c5edc17a7acd8701df6fc341c0d179f1c62c982"


def download():
    from huggingface_hub import snapshot_download
    snapshot_download(MODEL, revision=REVISION)


root = Path(__file__).parent
image = (modal.Image.debian_slim(python_version="3.11")
         .pip_install("fastapi[standard]==0.116.1", "laya==0.3.4", "torch==2.7.1", "transformers==4.56.2")
         .run_function(download)
         .env({"USE_TF": "0", "LAYA_REVISION": REVISION, "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"})
         .add_local_file(root / "adapter.py", "/root/adapter.py")
         .add_local_file(root / "runtime.py", "/root/runtime.py"))
app = modal.App("classifier-laya-router-trial")
resources = dict(image=image, gpu="L4", cpu=2, memory=4096,
                 compute_region=None, routing_region="us-east", unauthenticated=False,
                 max_containers=1, target_concurrency=1, startup_timeout=240)


@app.server(**resources, min_containers=1, scaledown_window=300)
class Fast:
    @modal.enter()
    def start(self):
        from runtime import start_server
        self.server = start_server("fast")


@app.server(**resources, min_containers=0, scaledown_window=60)
class Bulk:
    @modal.enter()
    def start(self):
        from runtime import start_server
        self.server = start_server("bulk")
