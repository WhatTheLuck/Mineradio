"""Compare original and staged offline model embeddings on the same input."""
import base64
import json
import math
import os
import struct
import subprocess
import sys
import tempfile

worker, full_model, staged_model = sys.argv[1:4]
if len(sys.argv) > 4:
    import librosa
    waveform, _ = librosa.load(sys.argv[4], sr=24000, mono=True)
    start = max(0, min(len(waveform) - 240000, len(waveform) // 3))
    pcm = waveform[start:start + 240000]
else:
    pcm = [0.05 * math.sin(2 * math.pi * 440 * i / 24000) for i in range(240000)]
requests = [
    {'id': 1, 'kind': 'text', 'text': '适合在开车时听的音乐'},
    {'id': 2, 'kind': 'audio', 'pcm': base64.b64encode(struct.pack('<240000f', *pcm)).decode('ascii')},
]

def run(model):
    env = dict(os.environ)
    label = 'full' if model == full_model else 'variant'
    env['MINERADIO_MUQ_EXPANDED_ROOT'] = os.path.join(tempfile.gettempdir(), 'mineradio-muq-compare-v6-' + label)
    process = subprocess.Popen([sys.executable, worker, model], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
    vectors = []
    try:
        for request in requests:
            process.stdin.write(json.dumps(request, ensure_ascii=False) + '\n')
            process.stdin.flush()
            while True:
                line = process.stdout.readline()
                if not line:
                    raise RuntimeError(process.stderr.read()[-1000:])
                try:
                    result = json.loads(line)
                    break
                except json.JSONDecodeError:
                    continue
            if result.get('error'):
                raise RuntimeError(result['error'])
            vectors.append(result['vector'])
    finally:
        process.terminate()
        process.wait(timeout=10)
    return vectors

full, staged = run(full_model), run(staged_model)
for label, a, b in zip(('text', 'audio'), full, staged):
    cosine = sum(x * y for x, y in zip(a, b))
    print(f'{label} staged/full cosine: {cosine:.6f}')
    if cosine < 0.98:
        raise RuntimeError(f'{label} embedding drift is too large')
