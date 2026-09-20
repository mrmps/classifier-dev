"""Global trial: one warm fast GPU, bulk scales to zero; one GPU maximum per lane."""
from pathlib import Path
import modal

MODEL = "convaiinnovations/laya"


def download():
    from huggingface_hub import snapshot_download
    snapshot_download(MODEL, ignore_patterns=["multilingual/*", "typed-decisions/*"])


root = Path(__file__).parent
image = (modal.Image.debian_slim(python_version="3.11")
         .pip_install("fastapi[standard]==0.116.1", "laya==0.3.4", "torch==2.7.1", "transformers==4.56.2")
         .run_function(download)
         .add_local_file(root / "adapter.py", "/root/adapter.py")
         .add_local_file(root / "runtime.py", "/root/runtime.py"))
app = modal.App("classifier-laya-trial")
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
