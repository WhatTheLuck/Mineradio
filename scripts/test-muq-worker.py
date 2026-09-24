"""Smoke test the local MuQ worker with one text and one 10-second sample."""
import base64
import json
import math
import os
import struct
import subprocess
import sys
import tempfile

worker = sys.argv[1]
model_dir = sys.argv[2]
command = [worker, model_dir]
if worker.lower().endswith('.py'):
    command.insert(0, sys.executable)
environment = dict(os.environ)
environment.setdefault('MINERADIO_MUQ_EXPANDED_ROOT', os.path.join(tempfile.gettempdir(), 'mineradio-muq-smoke-v6'))
process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=environment)
samples = [0.05 * math.sin(2 * math.pi * 440 * i / 24000) for i in range(240000)]
payload = base64.b64encode(struct.pack('<240000f', *samples)).decode('ascii')
requests = [
    {'id': 1, 'kind': 'text', 'text': '适合在开车时听的音乐'},
    {'id': 2, 'kind': 'audio', 'pcm': payload},
]
try:
    for request in requests:
        process.stdin.write(json.dumps(request, ensure_ascii=False) + '\n')
        process.stdin.flush()
        while True:
            line = process.stdout.readline()
            if not line:
                raise RuntimeError('Worker exited: ' + process.stderr.read()[-1000:])
            try:
                result = json.loads(line)
                break
            except json.JSONDecodeError:
                continue
        expected = request['id']
        if result.get('error') or result.get('id') != expected or not result.get('vector'):
            raise RuntimeError(str(result))
        print(f"request {expected}: {len(result['vector'])} dimensions")
finally:
    process.terminate()
    process.wait(timeout=10)
